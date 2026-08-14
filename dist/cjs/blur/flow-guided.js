"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlowGuidedBlur = exports.WebGPUFlowGuidedBlur = exports.WebGLFlowGuidedBlur = exports.CPUFlowGuidedBlur = void 0;
const base_js_1 = require("../base.js");
const webgl2_flow_blur_glsl_js_1 = require("./shaders/flow-guided/webgl2-flow-blur.glsl.js");
const webgl2_vertex_glsl_js_1 = require("./shaders/flow-guided/webgl2-vertex.glsl.js");
const webgpu_flow_blur_wgsl_js_1 = require("./shaders/flow-guided/webgpu-flow-blur.wgsl.js");
const image_js_1 = require("../utils/image.js");
const math_js_1 = require("../utils/math.js");
const device_js_1 = require("../utils/device.js");
const DEFAULT_FLOW_CONFIG = {
    kernelSizeMultiplier: 6,
    stepSize: 1.0,
};
class CPUFlowGuidedBlur extends base_js_1.BaseCPUStrategy {
    flowField;
    config;
    constructor(flowField, config = {}) {
        super();
        this.flowField = flowField;
        this.config = { ...DEFAULT_FLOW_CONFIG, ...config };
    }
    /** CPU is always available */
    static async isSupported() {
        return true;
    }
    dispose() { }
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
        const output = (0, image_js_1.createChannelImage)(input.width, input.height);
        // Number of samples along the flow line
        // Paper samples at 2× sigma in each direction
        const halfSamples = Math.ceil(sigma * 2 / this.config.stepSize);
        const numSamples = halfSamples * 2 + 1;
        // Generate 1D Gaussian weights
        const weights = (0, math_js_1.generateGaussianKernel)(sigma, numSamples);
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
        const stepSize = this.config.stepSize;
        let sum = 0;
        let weightSum = 0;
        // Sample at center (index = halfSamples)
        sum += (0, image_js_1.getPixelBilinear)(input, startX, startY) * weights[halfSamples];
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
            const value = (0, image_js_1.getPixelBilinear)(input, px, py);
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
            const value = (0, image_js_1.getPixelBilinear)(input, px, py);
            sum += value * weights[idx];
            weightSum += weights[idx];
        }
        return weightSum > 0 ? sum / weightSum : 0;
    }
}
exports.CPUFlowGuidedBlur = CPUFlowGuidedBlur;
const DEFAULT_WEBGL_CONFIG = {
    kernelSizeMultiplier: 6,
    maxKernelSize: 63,
};
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
/**
 * WebGL2-accelerated flow-guided blur
 * Uses line integral convolution along edge tangent directions
 */
class WebGLFlowGuidedBlur extends base_js_1.BaseWebGLStrategy {
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
    /**
     * Same check as WebGLIsotropicBlur: a real, hardware-accelerated WebGL2
     * context with float render targets, excluding software rasterizers.
     */
    static async isSupported() {
        return (0, device_js_1.isWebGLComputeSupported)();
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
        const program = createProgram(gl, webgl2_vertex_glsl_js_1.default, webgl2_flow_blur_glsl_js_1.default);
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
        const kernel = (0, math_js_1.generateGaussianKernel)(sigma, kernelSize);
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
        const output = (0, image_js_1.createChannelImage)(width, height);
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
exports.WebGLFlowGuidedBlur = WebGLFlowGuidedBlur;
const DEFAULT_WEBGPU_CONFIG = {
    kernelSizeMultiplier: 6,
    maxKernelSize: 127,
};
/**
 * WebGPU-accelerated flow-guided blur
 */
class WebGPUFlowGuidedBlur extends base_js_1.BaseWebGPUStrategy {
    config;
    flowField;
    resources = null;
    // proportional to kernel size, never to
    // image size, so there's no reason to ever tile these.
    kernelBuffer = null;
    currentKernelSize = 0;
    // Cached flow-field texture. Rebuilt when setFlowField() marks it dirty
    // or the image dimensions change. Baked in row-chunks (not one
    // Float32Array(width*height*2)) so preparing it for a huge image doesn't
    // itself blow up JS heap before any GPU work happens.
    flowTexture = null;
    flowFieldWidth = 0;
    flowFieldHeight = 0;
    flowDirty = true;
    static CPU_BAKE_ROWS_PER_CHUNK = 512;
    // Bytes we're willing to put in a single GPU buffer for one row-band
    // tile of *output*. Large images are processed in row-band tiles bounded
    // by this, so memory use stays flat regardless of image size
    maxTileBytes = 0;
    static TILE_MEMORY_SAFETY_FACTOR = 0.5;
    constructor(flowField, config = {}) {
        super();
        this.flowField = flowField;
        this.config = { ...DEFAULT_WEBGPU_CONFIG, ...config };
    }
    /**
     * Confirms an adapter is actually obtainable, not just that
     * `navigator.gpu` exists as an API surface.
     */
    static async isSupported() {
        return (0, device_js_1.isWebGPUSupported)();
    }
    async initResources() {
        if (this.resources)
            return this.resources;
        const device = await WebGPUFlowGuidedBlur.getWebGPUDevice();
        if (!device) {
            throw new Error('WebGPU device not available');
        }
        // maxBufferSize / maxStorageBufferBindingSize are usually the binding
        // constraint that bites first on large images (commonly 256MB / 128MB
        // by default, even when the adapter can do far more). Cap tile size to
        // half of whichever is smaller as a safety margin. Driver-reported
        // limits are the ceiling, not a size it's safe to actually hit.
        const limits = device.limits;
        this.maxTileBytes = Math.max(16 * 4, // never go below one row's worth of data at workgroup width 16
        Math.floor(Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize) *
            WebGPUFlowGuidedBlur.TILE_MEMORY_SAFETY_FACTOR));
        // Flow blur needs 5 bindings: params, kernel, input tex, flow tex, output.
        // input/flowField moved from storage buffers to textures (see
        // FLOW_BLUR_WGSL comment above) so they're bound by
        // maxTextureDimension2D instead of the much smaller storage-buffer
        // binding limit.
        const flowBindGroupLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        const pipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [flowBindGroupLayout],
        });
        const flowPipeline = device.createComputePipeline({
            layout: pipelineLayout,
            compute: {
                module: device.createShaderModule({ code: webgpu_flow_blur_wgsl_js_1.default }),
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
    /**
     * Textures are bound by maxTextureDimension2D (typically 8192-16384),
     * not the storage-buffer binding limit. That ceiling still exists,
     * and silently exceeding it is exactly the failure mode this fix is
     * closing off. Throw a clear, catchable error instead, so the
     * FlowGuidedBlur wrapper's fallback logic gets a chance to demote to
     * WebGL/CPU rather than the caller getting corrupted output.
     */
    assertWithinTextureLimits(device, width, height) {
        const maxDim = device.limits.maxTextureDimension2D;
        if (width > maxDim || height > maxDim) {
            throw new Error(`[FlowGuidedBlur/WebGPU] Image ${width}x${height} exceeds this device's ` +
                `maxTextureDimension2D (${maxDim}) on at least one axis. The input/flow ` +
                `textures are each a single full-image texture, so this can't be worked ` +
                `around by row-band tiling alone (that only bounds the output/readback ` +
                `buffers). Downscale the image, or split it into overlapping regions ` +
                `upstream and blur each region separately.`);
        }
    }
    /**
     * (Re)builds the flow-field texture for the given dimensions if it's
     * missing, stale (setFlowField() was called), or the wrong size. Built
     * in row-chunks rather than one Float32Array(width*height*2) for the
     * whole image, so preparing this for a large image doesn't itself blow
     * up JS heap before any GPU work happens.
     */
    bakeFlowTexture(device, width, height) {
        this.assertWithinTextureLimits(device, width, height);
        const newTexture = device.createTexture({
            size: [width, height],
            format: 'rg32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        const rowsPerChunk = Math.max(1, WebGPUFlowGuidedBlur.CPU_BAKE_ROWS_PER_CHUNK);
        for (let y0 = 0; y0 < height; y0 += rowsPerChunk) {
            const rows = Math.min(rowsPerChunk, height - y0);
            const chunk = new Float32Array(width * rows * 2);
            for (let ry = 0; ry < rows; ry++) {
                const y = y0 + ry;
                for (let x = 0; x < width; x++) {
                    const tangent = this.flowField.getTangent(x, y);
                    const idx = (ry * width + x) * 2;
                    chunk[idx] = tangent.x;
                    chunk[idx + 1] = tangent.y;
                }
            }
            device.queue.writeTexture({ texture: newTexture, origin: { x: 0, y: y0 } }, chunk, { bytesPerRow: width * 2 * 4, rowsPerImage: rows }, { width, height: rows });
        }
        const oldTexture = this.flowTexture;
        this.flowTexture = newTexture;
        oldTexture?.destroy();
        this.flowFieldWidth = width;
        this.flowFieldHeight = height;
        this.flowDirty = false;
        return newTexture;
    }
    getFlowTexture(device, width, height) {
        if (this.flowTexture &&
            !this.flowDirty &&
            this.flowFieldWidth === width &&
            this.flowFieldHeight === height) {
            return this.flowTexture;
        }
        return this.bakeFlowTexture(device, width, height);
    }
    /**
     * Update the flow field (e.g., when processing a new image). Marks the
     * cached flow texture dirty rather than rebuilding immediately. The
     * next blur() call rebuilds it against the dimensions that call actually
     * needs.
     */
    setFlowField(flowField) {
        this.flowField = flowField;
        this.flowDirty = true;
    }
    /**
     * MEMORY: the output/readback path is processed in row-band tiles
     * bounded by `maxTileBytes`, not one whole-image buffer
     */
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
        this.assertWithinTextureLimits(device, width, height);
        const flowTexture = this.getFlowTexture(device, width, height);
        const kernelSize = Math.min(this.config.maxKernelSize, Math.max(3, Math.floor(sigma * this.config.kernelSizeMultiplier) | 1));
        const kernel = (0, math_js_1.generateGaussianKernel)(sigma, kernelSize);
        if (this.currentKernelSize < kernelSize) {
            this.kernelBuffer?.destroy();
            this.kernelBuffer = device.createBuffer({
                size: kernelSize * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            this.currentKernelSize = kernelSize;
        }
        device.queue.writeBuffer(this.kernelBuffer, 0, new Float32Array(kernel));
        const inputTexture = device.createTexture({
            size: [width, height],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        const paramsBuffer = device.createBuffer({
            size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        // Row-band tile plan. Only the output/readback buffers scale with
        // tile size. input/flow textures above are still whole-image.
        const bytesPerRow = width * 4;
        const rowsPerTile = Math.max(1, Math.min(height, Math.floor(this.maxTileBytes / bytesPerRow)));
        const tileBufferSize = rowsPerTile * bytesPerRow;
        const outputBuffer = device.createBuffer({
            size: tileBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        const readBuffer = device.createBuffer({
            size: tileBufferSize,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        try {
            device.queue.writeTexture({ texture: inputTexture }, input.data, { bytesPerRow, rowsPerImage: height }, { width, height });
            const bindGroup = device.createBindGroup({
                layout: flowBindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: paramsBuffer } },
                    { binding: 1, resource: { buffer: this.kernelBuffer } },
                    { binding: 2, resource: inputTexture.createView() },
                    { binding: 3, resource: flowTexture.createView() },
                    { binding: 4, resource: { buffer: outputBuffer } },
                ],
            });
            const output = (0, image_js_1.createChannelImage)(width, height);
            // Tiles are processed sequentially (dispatch -> readback -> next),
            // since outputBuffer/readBuffer are reused across iterations.
            // reuse keeps memory bounded, at the cost of some
            // overlap opportunity between tiles.
            for (let rowOffset = 0; rowOffset < height; rowOffset += rowsPerTile) {
                const tileHeight = Math.min(rowsPerTile, height - rowOffset);
                device.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([width, height, kernelSize, rowOffset, tileHeight, 0, 0, 0]));
                const commandEncoder = device.createCommandEncoder();
                const computePass = commandEncoder.beginComputePass();
                computePass.setPipeline(flowPipeline);
                computePass.setBindGroup(0, bindGroup);
                computePass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(tileHeight / 16));
                computePass.end();
                commandEncoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, tileHeight * bytesPerRow);
                device.queue.submit([commandEncoder.finish()]);
                await readBuffer.mapAsync(GPUMapMode.READ, 0, tileHeight * bytesPerRow);
                const mapped = readBuffer.getMappedRange(0, tileHeight * bytesPerRow);
                output.data.set(new Float32Array(mapped), rowOffset * width);
                readBuffer.unmap();
            }
            return output;
        }
        finally {
            // Always release per-call resources, even if a pass or readback
            // throws, so concurrent/repeated calls don't leak GPU memory.
            inputTexture.destroy();
            outputBuffer.destroy();
            readBuffer.destroy();
            paramsBuffer.destroy();
        }
    }
    dispose() {
        this.kernelBuffer?.destroy();
        this.flowTexture?.destroy();
        this.kernelBuffer = null;
        this.currentKernelSize = 0;
        this.flowTexture = null;
        this.flowFieldWidth = 0;
        this.flowFieldHeight = 0;
        this.flowDirty = true;
        this.resources = null;
    }
}
exports.WebGPUFlowGuidedBlur = WebGPUFlowGuidedBlur;
/**
 * Backend-agnostic flow-guided blur. Same per-algorithm backend selection
 * and single-retry fallback as `IsotropicBlur`
 *
 * One addition here: the flow field is mutable,
 * so it has to be tracked on the wrapper too. A
 * fallback needs to construct the next backend with the *current* flow
 * field, not the one from construction time.
 */
class FlowGuidedBlur {
    instance;
    currentCtor;
    config;
    flowField;
    failedBackends = new Set();
    constructor(instance, currentCtor, config, flowField) {
        this.instance = instance;
        this.currentCtor = currentCtor;
        this.config = config;
        this.flowField = flowField;
    }
    // Ordered best-to-worst. `satisfies` (not `implements`) catches a
    // backend missing isSupported() or the instance shape at this line.
    static candidates = [
        WebGPUFlowGuidedBlur,
        WebGLFlowGuidedBlur,
        CPUFlowGuidedBlur,
    ];
    static async create(flowField, config = {}) {
        for (const Ctor of FlowGuidedBlur.candidates) {
            if (await Ctor.isSupported()) {
                try {
                    return new FlowGuidedBlur(new Ctor(flowField, config), Ctor, config, flowField);
                }
                catch {
                    continue; // isSupported() lied
                }
            }
        }
        throw new Error('No supported flow-guided blur implementation available');
    }
    get backend() {
        return this.instance.backend;
    }
    dispose() {
        this.instance.dispose();
    }
    async blur(input, sigma) {
        let current = this.instance;
        while (true) {
            try {
                console.log(`${this.constructor.name}: Running ${current.backend}`);
                return await current.blur(input, sigma);
            }
            catch (err) {
                console.warn(`${this.constructor.name}: [${this.currentCtor.name}] process() failed, attempting fallback:`, err);
                const fallback = await this.demoteAndFindNext();
                if (!fallback)
                    throw err;
                current = fallback;
            }
        }
    }
    /**
     * Update the flow field (e.g., when processing a new frame). Stored on
     * the wrapper too, so a later backend fallback hands the new instance
     * the current flow field rather than a stale one from construction time.
     */
    setFlowField(flowField) {
        this.flowField = flowField;
        this.instance.setFlowField(flowField);
    }
    async demoteAndFindNext() {
        this.failedBackends.add(this.currentCtor);
        this.instance.dispose();
        for (const Ctor of FlowGuidedBlur.candidates) {
            if (this.failedBackends.has(Ctor))
                continue;
            if (await Ctor.isSupported()) {
                try {
                    this.instance = new Ctor(this.flowField, this.config);
                    this.currentCtor = Ctor;
                    console.warn(`Falling back to ${Ctor.name}`);
                    return this.instance;
                }
                catch (err) {
                    console.warn(`[${Ctor.name}] construction failed despite isSupported():`, err);
                    this.failedBackends.add(Ctor);
                }
            }
        }
        return null;
    }
}
exports.FlowGuidedBlur = FlowGuidedBlur;
//# sourceMappingURL=flow-guided.js.map