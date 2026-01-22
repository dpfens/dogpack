import { createGrayscaleImage, getPixelBilinear, generateGaussianKernel } from '../utils.js';
import { createProgram } from '../utils/webgl.js';
import { BaseCPUBlur, BaseWebGLBlur, BaseWebGPUBlur } from './base.js';
const DEFAULT_FLOW_CONFIG = {
    kernelSizeMultiplier: 6,
    stepSize: 1.0,
};
export class CPUFlowGuidedBlur extends BaseCPUBlur {
    flowField;
    config;
    constructor(flowField, config = {}) {
        super();
        this.flowField = flowField;
        this.config = { ...DEFAULT_FLOW_CONFIG, ...config };
    }
    /**
     * Update the flow field (e.g., when processing a new image)
     */
    setFlowField(flowField) {
        this.flowField = flowField;
    }
    async blur(input, sigma) {
        if (sigma < 0.1) {
            return {
                data: new Float32Array(input.data),
                width: input.width,
                height: input.height,
            };
        }
        const output = createGrayscaleImage(input.width, input.height);
        // Number of samples along the flow line
        // Paper samples at 2× sigma in each direction
        const halfSamples = Math.ceil(sigma * 2 / this.config.stepSize);
        const numSamples = halfSamples * 2 + 1;
        // Generate 1D Gaussian weights
        const weights = generateGaussianKernel(sigma, numSamples);
        for (let y = 0; y < input.height; y++) {
            for (let x = 0; x < input.width; x++) {
                const value = this.sampleAlongFlow(input, x, y, halfSamples, weights);
                output.data[y * input.width + x] = value;
            }
        }
        return output;
    }
    /**
     * Sample along the flow direction using line integral convolution
     *
     * This follows the tangent field in both directions from the starting point,
     * accumulating weighted samples to produce a blur along the edge direction.
     */
    sampleAlongFlow(input, startX, startY, halfSamples, weights) {
        const numSamples = weights.length;
        const stepSize = this.config.stepSize;
        let sum = 0;
        let weightSum = 0;
        // Sample at center (index = halfSamples)
        sum += getPixelBilinear(input, startX, startY) * weights[halfSamples];
        weightSum += weights[halfSamples];
        // Sample in positive flow direction
        let px = startX;
        let py = startY;
        for (let i = 1; i <= halfSamples; i++) {
            // Step along flow
            const tangent = this.flowField.getTangent(Math.round(px), Math.round(py));
            px += tangent.x * stepSize;
            py += tangent.y * stepSize;
            // Bounds check (with tolerance for interpolation)
            if (px < -0.5 || px > input.width - 0.5 ||
                py < -0.5 || py > input.height - 0.5) {
                break;
            }
            const idx = halfSamples + i;
            const value = getPixelBilinear(input, px, py);
            sum += value * weights[idx];
            weightSum += weights[idx];
        }
        // Sample in negative flow direction
        px = startX;
        py = startY;
        for (let i = 1; i <= halfSamples; i++) {
            // Step against flow
            const tangent = this.flowField.getTangent(Math.round(px), Math.round(py));
            px -= tangent.x * stepSize;
            py -= tangent.y * stepSize;
            // Bounds check
            if (px < -0.5 || px > input.width - 0.5 ||
                py < -0.5 || py > input.height - 0.5) {
                break;
            }
            const idx = halfSamples - i;
            const value = getPixelBilinear(input, px, py);
            sum += value * weights[idx];
            weightSum += weights[idx];
        }
        return weightSum > 0 ? sum / weightSum : 0;
    }
}
/**
 * Fragment shader for flow-guided blur (WebGL2)
 * Uses line integral convolution along edge tangent directions
 */
const FLOW_BLUR_SHADER = `#version 300 es
  precision highp float;
  
  uniform sampler2D u_image;
  uniform sampler2D u_flowField;
  uniform vec2 u_resolution;
  uniform float u_kernel[64];
  uniform int u_kernelSize;
  
  in vec2 v_texCoord;
  out vec4 fragColor;
  
  void main() {
    vec2 texelSize = 1.0 / u_resolution;
    int halfSize = u_kernelSize / 2;
    
    vec2 flow = texture(u_flowField, v_texCoord).rg * 2.0 - 1.0;
    
    float result = 0.0;
    float weightSum = 0.0;
    
    // Sample along positive flow direction
    vec2 pos = v_texCoord;
    for (int i = 0; i < 32; i++) {
      if (i > halfSize) break;
      int idx = halfSize + i;
      if (idx >= u_kernelSize) break;
      
      result += texture(u_image, pos).r * u_kernel[idx];
      weightSum += u_kernel[idx];
      
      vec2 localFlow = texture(u_flowField, pos).rg * 2.0 - 1.0;
      pos += localFlow * texelSize;
    }
    
    // Sample along negative flow direction
    pos = v_texCoord;
    for (int i = 1; i < 32; i++) {
      if (i > halfSize) break;
      int idx = halfSize - i;
      if (idx < 0) break;
      
      vec2 localFlow = texture(u_flowField, pos).rg * 2.0 - 1.0;
      pos -= localFlow * texelSize;
      
      result += texture(u_image, pos).r * u_kernel[idx];
      weightSum += u_kernel[idx];
    }
    
    result = weightSum > 0.0 ? result / weightSum : 0.0;
    fragColor = vec4(result, result, result, 1.0);
  }
`;
/**
 * Vertex shader for WebGL2 - simple fullscreen quad
 */
const VERTEX_SHADER = `#version 300 es
  in vec2 a_position;
  in vec2 a_texCoord;
  out vec2 v_texCoord;
  
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;
const DEFAULT_WEBGL_CONFIG = {
    kernelSizeMultiplier: 6,
    maxKernelSize: 63,
};
/**
 * WebGL2-accelerated flow-guided blur
 * Uses line integral convolution along edge tangent directions
 */
export class WebGLFlowGuidedBlur extends BaseWebGLBlur {
    config;
    flowField;
    resources = null;
    currentWidth = 0;
    currentHeight = 0;
    framebuffer = null;
    textures = [];
    flowTexture = null;
    constructor(flowField, config = {}) {
        super();
        this.flowField = flowField;
        this.config = { ...DEFAULT_WEBGL_CONFIG, ...config };
    }
    initResources() {
        if (this.resources)
            return this.resources;
        let canvas;
        if (typeof OffscreenCanvas !== 'undefined') {
            canvas = new OffscreenCanvas(1, 1);
        }
        else {
            canvas = document.createElement('canvas');
        }
        const gl = canvas.getContext('webgl2');
        if (!gl)
            throw new Error('WebGL2 is not supported');
        const program = createProgram(gl, VERTEX_SHADER, FLOW_BLUR_SHADER);
        const quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1, 1, 1,
        ]), gl.STATIC_DRAW);
        const texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            0, 0, 1, 0, 0, 1, 1, 1,
        ]), gl.STATIC_DRAW);
        this.resources = { gl, canvas, program, quadBuffer, texCoordBuffer };
        return this.resources;
    }
    ensureTextureSize(gl, width, height) {
        if (this.currentWidth === width && this.currentHeight === height) {
            return;
        }
        for (const tex of this.textures) {
            gl.deleteTexture(tex);
        }
        if (this.flowTexture) {
            gl.deleteTexture(this.flowTexture);
        }
        if (this.framebuffer) {
            gl.deleteFramebuffer(this.framebuffer);
        }
        this.textures = [];
        for (let i = 0; i < 2; i++) {
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            this.textures.push(texture);
        }
        this.flowTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.flowTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const flowData = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                const tangent = this.flowField.getTangent(x, y);
                flowData[idx] = Math.round((tangent.x + 1) * 0.5 * 255);
                flowData[idx + 1] = Math.round((tangent.y + 1) * 0.5 * 255);
                flowData[idx + 2] = 0;
                flowData[idx + 3] = 255;
            }
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, flowData);
        this.framebuffer = gl.createFramebuffer();
        this.currentWidth = width;
        this.currentHeight = height;
        const { canvas } = this.resources;
        canvas.width = width;
        canvas.height = height;
    }
    /**
     * Update the flow field (e.g., when processing a new image)
     */
    setFlowField(flowField) {
        this.flowField = flowField;
    }
    async blur(input, sigma) {
        if (sigma < 0.1) {
            return {
                data: new Float32Array(input.data),
                width: input.width,
                height: input.height,
            };
        }
        const { gl, program, quadBuffer, texCoordBuffer } = this.initResources();
        const { width, height } = input;
        this.ensureTextureSize(gl, width, height);
        const kernelSize = Math.min(this.config.maxKernelSize, Math.max(3, Math.floor(sigma * this.config.kernelSizeMultiplier) | 1));
        const kernel = generateGaussianKernel(sigma, kernelSize);
        const paddedKernel = new Float32Array(64);
        paddedKernel.set(kernel);
        const inputRGBA = new Uint8Array(width * height * 4);
        for (let i = 0; i < input.data.length; i++) {
            const value = Math.max(0, Math.min(255, Math.round(input.data[i] * 255)));
            inputRGBA[i * 4] = value;
            inputRGBA[i * 4 + 1] = value;
            inputRGBA[i * 4 + 2] = value;
            inputRGBA[i * 4 + 3] = 255;
        }
        gl.bindTexture(gl.TEXTURE_2D, this.textures[0]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, inputRGBA);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[1], 0);
        gl.viewport(0, 0, width, height);
        gl.useProgram(program);
        const positionLoc = gl.getAttribLocation(program, 'a_position');
        const texCoordLoc = gl.getAttribLocation(program, 'a_texCoord');
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(positionLoc);
        gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.enableVertexAttribArray(texCoordLoc);
        gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[0]);
        gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.flowTexture);
        gl.uniform1i(gl.getUniformLocation(program, 'u_flowField'), 1);
        gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), width, height);
        gl.uniform1fv(gl.getUniformLocation(program, 'u_kernel'), paddedKernel);
        gl.uniform1i(gl.getUniformLocation(program, 'u_kernelSize'), kernel.length);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        const outputRGBA = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, outputRGBA);
        const output = createGrayscaleImage(width, height);
        for (let i = 0; i < output.data.length; i++) {
            output.data[i] = outputRGBA[i * 4] / 255;
        }
        return output;
    }
    dispose() {
        if (!this.resources)
            return;
        const { gl } = this.resources;
        gl.deleteProgram(this.resources.program);
        gl.deleteBuffer(this.resources.quadBuffer);
        gl.deleteBuffer(this.resources.texCoordBuffer);
        for (const tex of this.textures) {
            gl.deleteTexture(tex);
        }
        if (this.flowTexture) {
            gl.deleteTexture(this.flowTexture);
        }
        if (this.framebuffer) {
            gl.deleteFramebuffer(this.framebuffer);
        }
        this.resources = null;
        this.textures = [];
        this.flowTexture = null;
        this.framebuffer = null;
    }
}
/**
 * WebGPU compute shader for flow-guided blur
 */
const FLOW_BLUR_WGSL = `
  struct Params {
    width: u32,
    height: u32,
    kernelSize: u32,
    _padding: u32,
  }
  
  @group(0) @binding(0) var<uniform> params: Params;
  @group(0) @binding(1) var<storage, read> kernel: array<f32>;
  @group(0) @binding(2) var<storage, read> input: array<f32>;
  @group(0) @binding(3) var<storage, read> flowField: array<vec2<f32>>;
  @group(0) @binding(4) var<storage, read_write> output: array<f32>;
  
  fn sampleBilinear(x: f32, y: f32) -> f32 {
    let x0 = u32(floor(x));
    let y0 = u32(floor(y));
    let x1 = min(x0 + 1u, params.width - 1u);
    let y1 = min(y0 + 1u, params.height - 1u);
    
    let fx = x - floor(x);
    let fy = y - floor(y);
    
    let v00 = input[x0 + y0 * params.width];
    let v10 = input[x1 + y0 * params.width];
    let v01 = input[x0 + y1 * params.width];
    let v11 = input[x1 + y1 * params.width];
    
    return v00 * (1.0 - fx) * (1.0 - fy) +
           v10 * fx * (1.0 - fy) +
           v01 * (1.0 - fx) * fy +
           v11 * fx * fy;
  }
  
  fn getFlow(x: f32, y: f32) -> vec2<f32> {
    let cx = clamp(u32(round(x)), 0u, params.width - 1u);
    let cy = clamp(u32(round(y)), 0u, params.height - 1u);
    return flowField[cx + cy * params.width];
  }
  
  @compute @workgroup_size(16, 16)
  fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
      return;
    }
    
    let halfKernel = i32(params.kernelSize) / 2;
    var sum: f32 = 0.0;
    var weightSum: f32 = 0.0;
    
    // Sample in positive flow direction
    var px: f32 = f32(x);
    var py: f32 = f32(y);
    for (var i: i32 = halfKernel; i < i32(params.kernelSize); i++) {
      sum += sampleBilinear(px, py) * kernel[i];
      weightSum += kernel[i];
      
      let tangent = getFlow(px, py);
      px += tangent.x;
      py += tangent.y;
    }
    
    // Sample in negative flow direction
    px = f32(x);
    py = f32(y);
    for (var i: i32 = halfKernel - 1; i >= 0; i--) {
      let tangent = getFlow(px, py);
      px -= tangent.x;
      py -= tangent.y;
      
      sum += sampleBilinear(px, py) * kernel[i];
      weightSum += kernel[i];
    }
    
    if (weightSum > 0.0) {
      output[x + y * params.width] = sum / weightSum;
    } else {
      output[x + y * params.width] = 0.0;
    }
  }
`;
const DEFAULT_WEBGPU_CONFIG = {
    kernelSizeMultiplier: 6,
    maxKernelSize: 127,
};
/**
 * WebGPU-accelerated flow-guided blur
 */
export class WebGPUFlowGuidedBlur extends BaseWebGPUBlur {
    config;
    flowField;
    resources = null;
    // Buffers
    paramsBuffer = null;
    kernelBuffer = null;
    inputBuffer = null;
    flowBuffer = null;
    outputBuffer = null;
    stagingBuffer = null;
    currentBufferSize = 0;
    currentKernelSize = 0;
    constructor(flowField, config = {}) {
        super();
        this.flowField = flowField;
        this.config = { ...DEFAULT_WEBGPU_CONFIG, ...config };
    }
    async initResources() {
        if (this.resources)
            return this.resources;
        const device = await WebGPUFlowGuidedBlur.getWebGPUDevice();
        if (!device) {
            throw new Error('WebGPU device not available');
        }
        // Flow blur needs 5 bindings
        const flowBindGroupLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        const pipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [flowBindGroupLayout],
        });
        const flowPipeline = device.createComputePipeline({
            layout: pipelineLayout,
            compute: {
                module: device.createShaderModule({ code: FLOW_BLUR_WGSL }),
                entryPoint: 'main',
            },
        });
        this.resources = {
            device,
            horizontalPipeline: null, // Not used for flow blur
            verticalPipeline: null,
            bindGroupLayout: flowBindGroupLayout,
            flowPipeline,
            flowBindGroupLayout,
        };
        return this.resources;
    }
    ensureBuffers(device, width, height, kernelSize) {
        const pixelCount = width * height;
        const bufferSize = pixelCount * 4;
        const flowBufferSize = pixelCount * 8; // vec2<f32> per pixel
        if (this.currentBufferSize < bufferSize) {
            this.inputBuffer?.destroy();
            this.flowBuffer?.destroy();
            this.outputBuffer?.destroy();
            this.stagingBuffer?.destroy();
            this.inputBuffer = device.createBuffer({
                size: bufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            this.flowBuffer = device.createBuffer({
                size: flowBufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            this.outputBuffer = device.createBuffer({
                size: bufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
            });
            this.stagingBuffer = device.createBuffer({
                size: bufferSize,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            });
            this.currentBufferSize = bufferSize;
            // Upload flow field
            const flowData = new Float32Array(pixelCount * 2);
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 2;
                    const tangent = this.flowField.getTangent(x, y);
                    flowData[idx] = tangent.x;
                    flowData[idx + 1] = tangent.y;
                }
            }
            device.queue.writeBuffer(this.flowBuffer, 0, flowData);
        }
        if (this.currentKernelSize < kernelSize) {
            this.kernelBuffer?.destroy();
            this.kernelBuffer = device.createBuffer({
                size: kernelSize * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            this.currentKernelSize = kernelSize;
        }
        if (!this.paramsBuffer) {
            this.paramsBuffer = device.createBuffer({
                size: 16,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
        }
    }
    /**
     * Update the flow field (e.g., when processing a new image)
     */
    setFlowField(flowField) {
        this.flowField = flowField;
    }
    async blur(input, sigma) {
        if (sigma < 0.1) {
            return {
                data: new Float32Array(input.data),
                width: input.width,
                height: input.height,
            };
        }
        const { device, flowPipeline, flowBindGroupLayout } = await this.initResources();
        const { width, height } = input;
        const pixelCount = width * height;
        const kernelSize = Math.min(this.config.maxKernelSize, Math.max(3, Math.floor(sigma * this.config.kernelSizeMultiplier) | 1));
        const kernel = generateGaussianKernel(sigma, kernelSize);
        this.ensureBuffers(device, width, height, kernelSize);
        device.queue.writeBuffer(this.paramsBuffer, 0, new Uint32Array([width, height, kernelSize, 0]));
        device.queue.writeBuffer(this.kernelBuffer, 0, new Float32Array(kernel));
        device.queue.writeBuffer(this.inputBuffer, 0, new Float32Array(input.data));
        const bindGroup = device.createBindGroup({
            layout: flowBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.paramsBuffer } },
                { binding: 1, resource: { buffer: this.kernelBuffer } },
                { binding: 2, resource: { buffer: this.inputBuffer } },
                { binding: 3, resource: { buffer: this.flowBuffer } },
                { binding: 4, resource: { buffer: this.outputBuffer } },
            ],
        });
        const workgroupsX = Math.ceil(width / 16);
        const workgroupsY = Math.ceil(height / 16);
        const commandEncoder = device.createCommandEncoder();
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(flowPipeline);
        computePass.setBindGroup(0, bindGroup);
        computePass.dispatchWorkgroups(workgroupsX, workgroupsY);
        computePass.end();
        commandEncoder.copyBufferToBuffer(this.outputBuffer, 0, this.stagingBuffer, 0, pixelCount * 4);
        device.queue.submit([commandEncoder.finish()]);
        await this.stagingBuffer.mapAsync(GPUMapMode.READ);
        const resultData = new Float32Array(this.stagingBuffer.getMappedRange().slice(0));
        this.stagingBuffer.unmap();
        return {
            data: resultData,
            width,
            height,
        };
    }
    dispose() {
        this.paramsBuffer?.destroy();
        this.kernelBuffer?.destroy();
        this.inputBuffer?.destroy();
        this.flowBuffer?.destroy();
        this.outputBuffer?.destroy();
        this.stagingBuffer?.destroy();
        this.paramsBuffer = null;
        this.kernelBuffer = null;
        this.inputBuffer = null;
        this.flowBuffer = null;
        this.outputBuffer = null;
        this.stagingBuffer = null;
        this.currentBufferSize = 0;
        this.currentKernelSize = 0;
        this.resources = null;
    }
}
export class FlowGuidedBlur {
    instance;
    constructor(flowField, config = {}) {
        if (WebGPUFlowGuidedBlur.isSupported()) {
            this.instance = new WebGPUFlowGuidedBlur(flowField, config);
        }
        else if (WebGLFlowGuidedBlur.isSupported()) {
            this.instance = new WebGLFlowGuidedBlur(flowField, config);
        }
        else {
            this.instance = new CPUFlowGuidedBlur(flowField, config);
        }
    }
    async blur(input, sigma) {
        return this.instance.blur(input, sigma);
    }
    /**
     * Update the flow field (e.g., when processing a new image)
     */
    setFlowField(flowField) {
        this.instance.setFlowField(flowField);
    }
}
//# sourceMappingURL=flow-guided.js.map