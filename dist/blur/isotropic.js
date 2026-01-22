/**
 * Blur strategies for DoG processing
 *
 * Provides both isotropic (standard) and anisotropic (flow-guided) blur
 * implementations for use in XDoG and FDoG pipelines.
 */
import { createGrayscaleImage, getPixel, generateGaussianKernel, computeKernelSize } from '../utils.js';
import { BaseCPUBlur, BaseWebGLBlur, BaseWebGPUBlur } from './base.js';
const DEFAULT_ISOTROPIC_CONFIG = {
    kernelSizeMultiplier: 6,
};
const DEFAULT_FLOW_CONFIG = {
    kernelSizeMultiplier: 6,
    stepSize: 1.0,
};
/**
 * Standard isotropic Gaussian blur using separable convolution
 * This is the blur used in basic XDoG
 */
export class CPUIsotropicBlur extends BaseCPUBlur {
    config;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_ISOTROPIC_CONFIG, ...config };
    }
    async blur(input, sigma) {
        if (sigma < 0.1) {
            // For very small sigma, just return a copy
            return {
                data: new Float32Array(input.data),
                width: input.width,
                height: input.height,
            };
        }
        // Compute kernel size (odd number)
        const kernelSize = computeKernelSize(sigma, this.config.kernelSizeMultiplier);
        const kernel = generateGaussianKernel(sigma, kernelSize);
        const halfKernel = Math.floor(kernelSize / 2);
        // Separable convolution: horizontal pass
        const temp = createGrayscaleImage(input.width, input.height);
        for (let y = 0; y < input.height; y++) {
            for (let x = 0; x < input.width; x++) {
                let sum = 0;
                for (let k = 0; k < kernelSize; k++) {
                    const sampleX = x + k - halfKernel;
                    sum += getPixel(input, sampleX, y) * kernel[k];
                }
                temp.data[y * input.width + x] = sum;
            }
        }
        // Separable convolution: vertical pass
        const output = createGrayscaleImage(input.width, input.height);
        for (let y = 0; y < input.height; y++) {
            for (let x = 0; x < input.width; x++) {
                let sum = 0;
                for (let k = 0; k < kernelSize; k++) {
                    const sampleY = y + k - halfKernel;
                    sum += getPixel(temp, x, sampleY) * kernel[k];
                }
                output.data[y * input.width + x] = sum;
            }
        }
        return output;
    }
}
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
/**
 * Fragment shader for horizontal Gaussian blur pass (WebGL2)
 */
const HORIZONTAL_BLUR_SHADER = `#version 300 es
  precision highp float;
  
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform float u_kernel[64];
  uniform int u_kernelSize;
  
  in vec2 v_texCoord;
  out vec4 fragColor;
  
  void main() {
    vec2 texelSize = 1.0 / u_resolution;
    float result = 0.0;
    int halfSize = u_kernelSize / 2;
    
    for (int i = 0; i < 64; i++) {
      if (i >= u_kernelSize) break;
      int offset = i - halfSize;
      vec2 samplePos = v_texCoord + vec2(float(offset) * texelSize.x, 0.0);
      result += texture(u_image, samplePos).r * u_kernel[i];
    }
    
    fragColor = vec4(result, result, result, 1.0);
  }
`;
/**
 * Fragment shader for vertical Gaussian blur pass (WebGL2)
 */
const VERTICAL_BLUR_SHADER = `#version 300 es
  precision highp float;
  
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform float u_kernel[64];
  uniform int u_kernelSize;
  
  in vec2 v_texCoord;
  out vec4 fragColor;
  
  void main() {
    vec2 texelSize = 1.0 / u_resolution;
    float result = 0.0;
    int halfSize = u_kernelSize / 2;
    
    for (int i = 0; i < 64; i++) {
      if (i >= u_kernelSize) break;
      int offset = i - halfSize;
      vec2 samplePos = v_texCoord + vec2(0.0, float(offset) * texelSize.y);
      result += texture(u_image, samplePos).r * u_kernel[i];
    }
    
    fragColor = vec4(result, result, result, 1.0);
  }
`;
/**
 * Compile a WebGL2 shader
 */
function compileShader(gl, source, type) {
    const shader = gl.createShader(type);
    if (!shader) {
        throw new Error('Failed to create shader');
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Shader compilation failed: ${info}`);
    }
    return shader;
}
/**
 * Create a WebGL2 program from vertex and fragment shaders
 */
function createProgram(gl, vertexSource, fragmentSource) {
    const vertexShader = compileShader(gl, vertexSource, gl.VERTEX_SHADER);
    const fragmentShader = compileShader(gl, fragmentSource, gl.FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) {
        throw new Error('Failed to create program');
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`Program linking failed: ${info}`);
    }
    // Clean up shaders (they're now part of the program)
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return program;
}
const DEFAULT_WEBGL_CONFIG = {
    kernelSizeMultiplier: 6,
    maxKernelSize: 63,
};
/**
 * WebGL2-accelerated isotropic Gaussian blur
 * Uses separable convolution with two passes (horizontal + vertical)
 */
export class WebGLIsotropicBlur extends BaseWebGLBlur {
    config;
    resources = null;
    currentWidth = 0;
    currentHeight = 0;
    framebuffer = null;
    textures = [];
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_WEBGL_CONFIG, ...config };
    }
    /**
     * Initialize WebGL2 resources lazily
     */
    initResources() {
        if (this.resources) {
            return this.resources;
        }
        let canvas;
        if (typeof OffscreenCanvas !== 'undefined') {
            canvas = new OffscreenCanvas(1, 1);
        }
        else {
            canvas = document.createElement('canvas');
        }
        const gl = canvas.getContext('webgl2');
        if (!gl) {
            throw new Error('WebGL2 is not supported');
        }
        const horizontalBlurProgram = createProgram(gl, VERTEX_SHADER, HORIZONTAL_BLUR_SHADER);
        const verticalBlurProgram = createProgram(gl, VERTEX_SHADER, VERTICAL_BLUR_SHADER);
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
        this.resources = {
            gl,
            canvas,
            horizontalBlurProgram,
            verticalBlurProgram,
            quadBuffer,
            texCoordBuffer,
        };
        return this.resources;
    }
    /**
     * Ensure textures are the right size, recreate if needed
     */
    ensureTextureSize(gl, width, height) {
        if (this.currentWidth === width && this.currentHeight === height) {
            return;
        }
        for (const tex of this.textures) {
            gl.deleteTexture(tex);
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
        this.framebuffer = gl.createFramebuffer();
        this.currentWidth = width;
        this.currentHeight = height;
        const { canvas } = this.resources;
        canvas.width = width;
        canvas.height = height;
    }
    /**
     * Apply Gaussian blur to the input image
     */
    async blur(input, sigma) {
        if (sigma < 0.1) {
            return {
                data: new Float32Array(input.data),
                width: input.width,
                height: input.height,
            };
        }
        const { gl, horizontalBlurProgram, verticalBlurProgram, quadBuffer, texCoordBuffer } = this.initResources();
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
        // Pass 1: Horizontal blur
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[1], 0);
        gl.viewport(0, 0, width, height);
        gl.useProgram(horizontalBlurProgram);
        const hPosLoc = gl.getAttribLocation(horizontalBlurProgram, 'a_position');
        const hTexLoc = gl.getAttribLocation(horizontalBlurProgram, 'a_texCoord');
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(hPosLoc);
        gl.vertexAttribPointer(hPosLoc, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.enableVertexAttribArray(hTexLoc);
        gl.vertexAttribPointer(hTexLoc, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[0]);
        gl.uniform1i(gl.getUniformLocation(horizontalBlurProgram, 'u_image'), 0);
        gl.uniform2f(gl.getUniformLocation(horizontalBlurProgram, 'u_resolution'), width, height);
        gl.uniform1fv(gl.getUniformLocation(horizontalBlurProgram, 'u_kernel'), paddedKernel);
        gl.uniform1i(gl.getUniformLocation(horizontalBlurProgram, 'u_kernelSize'), kernel.length);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        // Pass 2: Vertical blur
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[0], 0);
        gl.useProgram(verticalBlurProgram);
        const vPosLoc = gl.getAttribLocation(verticalBlurProgram, 'a_position');
        const vTexLoc = gl.getAttribLocation(verticalBlurProgram, 'a_texCoord');
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(vPosLoc);
        gl.vertexAttribPointer(vPosLoc, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.enableVertexAttribArray(vTexLoc);
        gl.vertexAttribPointer(vTexLoc, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[1]);
        gl.uniform1i(gl.getUniformLocation(verticalBlurProgram, 'u_image'), 0);
        gl.uniform2f(gl.getUniformLocation(verticalBlurProgram, 'u_resolution'), width, height);
        gl.uniform1fv(gl.getUniformLocation(verticalBlurProgram, 'u_kernel'), paddedKernel);
        gl.uniform1i(gl.getUniformLocation(verticalBlurProgram, 'u_kernelSize'), kernel.length);
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
        gl.deleteProgram(this.resources.horizontalBlurProgram);
        gl.deleteProgram(this.resources.verticalBlurProgram);
        gl.deleteBuffer(this.resources.quadBuffer);
        gl.deleteBuffer(this.resources.texCoordBuffer);
        for (const tex of this.textures) {
            gl.deleteTexture(tex);
        }
        if (this.framebuffer) {
            gl.deleteFramebuffer(this.framebuffer);
        }
        this.resources = null;
        this.textures = [];
        this.framebuffer = null;
    }
}
const DEFAULT_WEBGPU_CONFIG = {
    kernelSizeMultiplier: 6,
    maxKernelSize: 127,
};
// Cache for WebGPU adapter/device (shared across instances)
let cachedAdapter = null;
let cachedDevice = null;
let devicePromise = null;
/**
 * Get or create WebGPU device (shared)
 */
async function getWebGPUDevice() {
    if (cachedDevice)
        return cachedDevice;
    if (devicePromise)
        return devicePromise;
    devicePromise = (async () => {
        try {
            if (!navigator.gpu)
                return null;
            cachedAdapter = await navigator.gpu.requestAdapter();
            if (!cachedAdapter)
                return null;
            cachedDevice = await cachedAdapter.requestDevice();
            // Handle device loss
            cachedDevice.lost.then(() => {
                cachedDevice = null;
                cachedAdapter = null;
                devicePromise = null;
            });
            return cachedDevice;
        }
        catch {
            return null;
        }
    })();
    return devicePromise;
}
/**
 * WebGPU compute shader for horizontal Gaussian blur
 */
const HORIZONTAL_BLUR_WGSL = `
  struct Params {
    width: u32,
    height: u32,
    kernelSize: u32,
    _padding: u32,
  }
  
  @group(0) @binding(0) var<uniform> params: Params;
  @group(0) @binding(1) var<storage, read> kernel: array<f32>;
  @group(0) @binding(2) var<storage, read> input: array<f32>;
  @group(0) @binding(3) var<storage, read_write> output: array<f32>;
  
  @compute @workgroup_size(16, 16)
  fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
      return;
    }
    
    let halfKernel = i32(params.kernelSize) / 2;
    var sum: f32 = 0.0;
    
    for (var k: i32 = 0; k < i32(params.kernelSize); k++) {
      let sampleX = clamp(i32(x) + k - halfKernel, 0, i32(params.width) - 1);
      let idx = u32(sampleX) + y * params.width;
      sum += input[idx] * kernel[k];
    }
    
    output[x + y * params.width] = sum;
  }
`;
/**
 * WebGPU compute shader for vertical Gaussian blur
 */
const VERTICAL_BLUR_WGSL = `
  struct Params {
    width: u32,
    height: u32,
    kernelSize: u32,
    _padding: u32,
  }
  
  @group(0) @binding(0) var<uniform> params: Params;
  @group(0) @binding(1) var<storage, read> kernel: array<f32>;
  @group(0) @binding(2) var<storage, read> input: array<f32>;
  @group(0) @binding(3) var<storage, read_write> output: array<f32>;
  
  @compute @workgroup_size(16, 16)
  fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
      return;
    }
    
    let halfKernel = i32(params.kernelSize) / 2;
    var sum: f32 = 0.0;
    
    for (var k: i32 = 0; k < i32(params.kernelSize); k++) {
      let sampleY = clamp(i32(y) + k - halfKernel, 0, i32(params.height) - 1);
      let idx = x + u32(sampleY) * params.width;
      sum += input[idx] * kernel[k];
    }
    
    output[x + y * params.width] = sum;
  }
`;
/**
 * WebGPU-accelerated isotropic Gaussian blur
 * Uses compute shaders with separable convolution
 */
export class WebGPUIsotropicBlur extends BaseWebGPUBlur {
    config;
    resources = null;
    initPromise = null;
    // Reusable buffers
    paramsBuffer = null;
    kernelBuffer = null;
    inputBuffer = null;
    tempBuffer = null;
    outputBuffer = null;
    stagingBuffer = null;
    currentBufferSize = 0;
    currentKernelSize = 0;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_WEBGPU_CONFIG, ...config };
    }
    /**
     * Initialize WebGPU resources
     */
    async initResources() {
        if (this.resources)
            return this.resources;
        const device = await WebGPUIsotropicBlur.getWebGPUDevice();
        if (!device) {
            throw new Error('WebGPU device not available');
        }
        // Create bind group layout
        const bindGroupLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        const pipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout],
        });
        // Create compute pipelines
        const horizontalPipeline = device.createComputePipeline({
            layout: pipelineLayout,
            compute: {
                module: device.createShaderModule({ code: HORIZONTAL_BLUR_WGSL }),
                entryPoint: 'main',
            },
        });
        const verticalPipeline = device.createComputePipeline({
            layout: pipelineLayout,
            compute: {
                module: device.createShaderModule({ code: VERTICAL_BLUR_WGSL }),
                entryPoint: 'main',
            },
        });
        this.resources = {
            device,
            horizontalPipeline,
            verticalPipeline,
            bindGroupLayout,
        };
        return this.resources;
    }
    /**
     * Ensure buffers are sized correctly
     */
    ensureBuffers(device, pixelCount, kernelSize) {
        const bufferSize = pixelCount * 4; // Float32
        if (this.currentBufferSize < bufferSize) {
            // Clean up old buffers
            this.inputBuffer?.destroy();
            this.tempBuffer?.destroy();
            this.outputBuffer?.destroy();
            this.stagingBuffer?.destroy();
            this.inputBuffer = device.createBuffer({
                size: bufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            this.tempBuffer = device.createBuffer({
                size: bufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
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
                size: 16, // 4 x u32
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
        }
    }
    /**
     * Blur implementation - must be called with await
     */
    async blur(input, sigma) {
        if (sigma < 0.1) {
            return {
                data: new Float32Array(input.data),
                width: input.width,
                height: input.height,
            };
        }
        const { device, horizontalPipeline, verticalPipeline, bindGroupLayout } = await this.initResources();
        const { width, height } = input;
        const pixelCount = width * height;
        // Compute kernel
        const kernelSize = Math.min(this.config.maxKernelSize, Math.max(3, Math.floor(sigma * this.config.kernelSizeMultiplier) | 1));
        const kernel = generateGaussianKernel(sigma, kernelSize);
        // Ensure buffers
        this.ensureBuffers(device, pixelCount, kernelSize);
        // Upload data (ensure we're using ArrayBuffer, not SharedArrayBuffer)
        device.queue.writeBuffer(this.paramsBuffer, 0, new Uint32Array([width, height, kernelSize, 0]));
        device.queue.writeBuffer(this.kernelBuffer, 0, new Float32Array(kernel));
        device.queue.writeBuffer(this.inputBuffer, 0, new Float32Array(input.data));
        // Create bind groups
        const horizontalBindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.paramsBuffer } },
                { binding: 1, resource: { buffer: this.kernelBuffer } },
                { binding: 2, resource: { buffer: this.inputBuffer } },
                { binding: 3, resource: { buffer: this.tempBuffer } },
            ],
        });
        const verticalBindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.paramsBuffer } },
                { binding: 1, resource: { buffer: this.kernelBuffer } },
                { binding: 2, resource: { buffer: this.tempBuffer } },
                { binding: 3, resource: { buffer: this.outputBuffer } },
            ],
        });
        // Dispatch compute
        const workgroupsX = Math.ceil(width / 16);
        const workgroupsY = Math.ceil(height / 16);
        const commandEncoder = device.createCommandEncoder();
        const horizontalPass = commandEncoder.beginComputePass();
        horizontalPass.setPipeline(horizontalPipeline);
        horizontalPass.setBindGroup(0, horizontalBindGroup);
        horizontalPass.dispatchWorkgroups(workgroupsX, workgroupsY);
        horizontalPass.end();
        const verticalPass = commandEncoder.beginComputePass();
        verticalPass.setPipeline(verticalPipeline);
        verticalPass.setBindGroup(0, verticalBindGroup);
        verticalPass.dispatchWorkgroups(workgroupsX, workgroupsY);
        verticalPass.end();
        // Copy to staging buffer
        commandEncoder.copyBufferToBuffer(this.outputBuffer, 0, this.stagingBuffer, 0, pixelCount * 4);
        device.queue.submit([commandEncoder.finish()]);
        // Read back result
        await this.stagingBuffer.mapAsync(GPUMapMode.READ);
        const resultData = new Float32Array(this.stagingBuffer.getMappedRange().slice(0));
        this.stagingBuffer.unmap();
        return {
            data: resultData,
            width,
            height,
        };
    }
    /**
     * Clean up GPU resources
     */
    dispose() {
        this.paramsBuffer?.destroy();
        this.kernelBuffer?.destroy();
        this.inputBuffer?.destroy();
        this.tempBuffer?.destroy();
        this.outputBuffer?.destroy();
        this.stagingBuffer?.destroy();
        this.paramsBuffer = null;
        this.kernelBuffer = null;
        this.inputBuffer = null;
        this.tempBuffer = null;
        this.outputBuffer = null;
        this.stagingBuffer = null;
        this.currentBufferSize = 0;
        this.currentKernelSize = 0;
        // Note: We don't destroy the device as it's shared
        this.resources = null;
    }
}
export class IsotropicBlur {
    instance;
    constructor(config) {
        if (WebGPUIsotropicBlur.isSupported()) {
            this.instance = new WebGPUIsotropicBlur(config);
        }
        else if (WebGLIsotropicBlur.isSupported()) {
            this.instance = new WebGLIsotropicBlur(config);
        }
        else {
            this.instance = new CPUIsotropicBlur(config);
        }
    }
    async blur(input, sigma) {
        return this.instance.blur(input, sigma);
    }
}
//# sourceMappingURL=isotropic.js.map