"use strict";
/**
 * Blur strategies for DoG processing
 *
 * Provides both isotropic (standard) and anisotropic (flow-guided) blur
 * implementations for use in XDoG and FDoG pipelines.
 *
 * Supports parallel/concurrent blur operations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IsotropicBlur = exports.WebGPUIsotropicBlur = exports.WebGLIsotropicBlur = exports.CPUIsotropicBlur = void 0;
const image_js_1 = require("../utils/image.js");
const device_js_1 = require("../utils/device.js");
const base_js_1 = require("../base.js");
const vertex_shader_wgsl_js_1 = require("../shaders/vertex-shader.wgsl.js");
const webgl_horizontal_blur_glsl_js_1 = require("./shaders/isotropic/webgl-horizontal-blur.glsl.js");
const webgl_vertical_blur_glsl_js_1 = require("./shaders/isotropic/webgl-vertical-blur.glsl.js");
const webgpu_horizontal_blur_wgsl_js_1 = require("./shaders/isotropic/webgpu-horizontal-blur.wgsl.js");
const webgpu_vertical_blur_wgsl_js_1 = require("./shaders/isotropic/webgpu-vertical-blur.wgsl.js");
const math_js_1 = require("../utils/math.js");
const DEFAULT_ISOTROPIC_CONFIG = {
    kernelSizeMultiplier: 6,
};
/**
 * Compute kernel size from sigma
 * Paper samples at all integer locations less than 2× sigma for flow-aligned,
 * and extends to 2.45σ for structure tensor blur
 *
 * @param sigma Standard deviation
 * @param multiplier Size multiplier (default 6 = 3σ on each side)
 */
function computeKernelSize(sigma, multiplier = 6) {
    // Ensure odd size for symmetric kernel
    return Math.max(3, Math.floor(sigma * multiplier) | 1);
}
/**
 * Standard isotropic Gaussian blur using separable convolution
 * This is the blur used in basic XDoG
 */
class CPUIsotropicBlur extends base_js_1.BaseCPUStrategy {
    config;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_ISOTROPIC_CONFIG, ...config };
    }
    /** CPU is always available — it's the universal fallback. */
    static async isSupported() {
        return true;
    }
    dispose() { }
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
        const kernel = (0, math_js_1.generateGaussianKernel)(sigma, kernelSize);
        const halfKernel = Math.floor(kernelSize / 2);
        // Separable convolution: horizontal pass
        const temp = (0, image_js_1.createChannelImage)(input.width, input.height);
        for (let y = 0; y < input.height; y++) {
            for (let x = 0; x < input.width; x++) {
                let sum = 0;
                for (let k = 0; k < kernelSize; k++) {
                    const sampleX = x + k - halfKernel;
                    sum += (0, image_js_1.getPixel)(input, sampleX, y) * kernel[k];
                }
                temp.data[y * input.width + x] = sum;
            }
        }
        // Separable convolution: vertical pass
        const output = (0, image_js_1.createChannelImage)(input.width, input.height);
        for (let y = 0; y < input.height; y++) {
            for (let x = 0; x < input.width; x++) {
                let sum = 0;
                for (let k = 0; k < kernelSize; k++) {
                    const sampleY = y + k - halfKernel;
                    sum += (0, image_js_1.getPixel)(temp, x, sampleY) * kernel[k];
                }
                output.data[y * input.width + x] = sum;
            }
        }
        return output;
    }
}
exports.CPUIsotropicBlur = CPUIsotropicBlur;
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
class WebGLIsotropicBlur extends base_js_1.BaseWebGLStrategy {
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
     * Cheap synchronous-in-spirit check (wrapped in a resolved Promise to
     * satisfy `BlurStrategyCtor`) Excludes software
     * rasterizers, which are too slow to be a useful GPU fallback.
     */
    static async isSupported() {
        return (0, device_js_1.isWebGLComputeSupported)();
    }
    initResources(canvas) {
        if (this.resources)
            return this.resources;
        const gl = canvas.getContext('webgl2');
        if (!gl) {
            throw new Error('WebGL2 not supported');
        }
        const quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
        const horizontalBlurProgram = createProgram(gl, vertex_shader_wgsl_js_1.default, webgl_horizontal_blur_glsl_js_1.default);
        const verticalBlurProgram = createProgram(gl, vertex_shader_wgsl_js_1.default, webgl_vertical_blur_glsl_js_1.default);
        this.resources = {
            gl,
            canvas,
            horizontalBlurProgram,
            verticalBlurProgram,
            quadBuffer: quadBuffer,
            texCoordBuffer: texCoordBuffer,
        };
        return this.resources;
    }
    async blur(input, sigma) {
        if (sigma < 0.1) {
            return {
                data: new Float32Array(input.data),
                width: input.width,
                height: input.height,
            };
        }
        const canvas = new OffscreenCanvas(1, 1);
        const resources = this.initResources(canvas);
        const { gl } = resources;
        const { width, height } = input;
        const kernelSize = Math.min(this.config.maxKernelSize, Math.max(3, Math.floor(sigma * this.config.kernelSizeMultiplier) | 1));
        const kernel = (0, math_js_1.generateGaussianKernel)(sigma, kernelSize);
        // Create or reuse textures
        if (this.currentWidth !== width || this.currentHeight !== height) {
            this.textures.forEach(t => gl.deleteTexture(t));
            this.textures = [];
            for (let i = 0; i < 3; i++) {
                const texture = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, null);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                this.textures.push(texture);
            }
            if (this.framebuffer) {
                gl.deleteFramebuffer(this.framebuffer);
            }
            this.framebuffer = gl.createFramebuffer();
            this.currentWidth = width;
            this.currentHeight = height;
        }
        // Upload input data
        gl.bindTexture(gl.TEXTURE_2D, this.textures[0]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.FLOAT, input.data);
        // Horizontal blur
        this.blurPass(resources, this.textures[0], this.textures[1], kernel, kernelSize, true);
        // Vertical blur
        this.blurPass(resources, this.textures[1], this.textures[2], kernel, kernelSize, false);
        // Read back result
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[2], 0);
        const resultData = new Float32Array(width * height);
        gl.readPixels(0, 0, width, height, gl.RED, gl.FLOAT, resultData);
        return {
            data: resultData,
            width,
            height,
        };
    }
    blurPass(resources, inputTexture, outputTexture, kernel, kernelSize, isHorizontal) {
        const { gl, quadBuffer, texCoordBuffer } = resources;
        const program = isHorizontal ? resources.horizontalBlurProgram : resources.verticalBlurProgram;
        gl.useProgram(program);
        gl.viewport(0, 0, this.currentWidth, this.currentHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outputTexture, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inputTexture);
        gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
        gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), this.currentWidth, this.currentHeight);
        gl.uniform1iv(gl.getUniformLocation(program, 'u_kernel'), Array.from(kernel));
        gl.uniform1i(gl.getUniformLocation(program, 'u_kernelSize'), kernelSize);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        const posLocation = gl.getAttribLocation(program, 'a_position');
        gl.vertexAttribPointer(posLocation, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(posLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
        gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(texCoordLocation);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    dispose() {
        if (this.resources) {
            const { gl } = this.resources;
            gl.deleteProgram(this.resources.horizontalBlurProgram);
            gl.deleteProgram(this.resources.verticalBlurProgram);
            gl.deleteBuffer(this.resources.quadBuffer);
            gl.deleteBuffer(this.resources.texCoordBuffer);
        }
        const { gl } = this.resources || { gl: null };
        if (gl) {
            this.textures.forEach(t => gl.deleteTexture(t));
            if (this.framebuffer) {
                gl.deleteFramebuffer(this.framebuffer);
            }
        }
        this.resources = null;
        this.textures = [];
        this.framebuffer = null;
        this.currentWidth = 0;
        this.currentHeight = 0;
    }
}
exports.WebGLIsotropicBlur = WebGLIsotropicBlur;
const DEFAULT_WEBGPU_CONFIG = {
    kernelSizeMultiplier: 6,
    maxKernelSize: 63,
};
/**
 * WebGPU-accelerated isotropic Gaussian blur
 * Uses compute shaders with separable convolution
 *
 * Supports concurrent/parallel blur calls by creating
 * separate staging buffers for each operation instead of reusing one.
 */
class WebGPUIsotropicBlur extends base_js_1.BaseWebGPUStrategy {
    config;
    resources = null;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_WEBGPU_CONFIG, ...config };
    }
    /**
     * Confirms an adapter is actually obtainable, not just that
     * `navigator.gpu` exists as an API surface.
     */
    static async isSupported() {
        return (0, device_js_1.isWebGPUSupported)();
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
                module: device.createShaderModule({ code: webgpu_horizontal_blur_wgsl_js_1.default }),
                entryPoint: 'main',
            },
        });
        const verticalPipeline = device.createComputePipeline({
            layout: pipelineLayout,
            compute: {
                module: device.createShaderModule({ code: webgpu_vertical_blur_wgsl_js_1.default }),
                entryPoint: 'main',
            },
        });
        return {
            device,
            horizontalPipeline,
            verticalPipeline,
            bindGroupLayout,
        };
    }
    /**
     * Fix for WebGPUIsotropicBlur: allocate buffers per call instead of
     * reusing instance-level ones, so concurrent blur() calls (as issued by
     * DoGProcessor.process()'s Promise.all([blur(sigma), blur(sigma*k)]))
     * never share mutable GPU state. Mirrors the pattern already used by
     * WebGPUFlowGuidedBlur and WebGPUGradientAlignedBlur.
     *
     * Delete the old paramsBuffer/kernelBuffer/inputBuffer/tempBuffer/
     * outputBuffer/currentBufferSize/currentKernelSize instance fields and
     * ensureBuffers() method; they're no longer needed.
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
        const bufferSize = pixelCount * 4;
        const kernelSize = Math.min(this.config.maxKernelSize, Math.max(3, Math.floor(sigma * this.config.kernelSizeMultiplier) | 1));
        const kernel = (0, math_js_1.generateGaussianKernel)(sigma, kernelSize);
        // Per-call resources -- never shared with a concurrent blur() call on
        // this same instance.
        const paramsBuffer = device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const kernelBuffer = device.createBuffer({
            size: kernelSize * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        const inputBuffer = device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        const tempBuffer = device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        const outputBuffer = device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        const stagingBuffer = device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        try {
            device.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([width, height, kernelSize, 0]));
            device.queue.writeBuffer(kernelBuffer, 0, new Float32Array(kernel));
            device.queue.writeBuffer(inputBuffer, 0, new Float32Array(input.data));
            const horizontalBindGroup = device.createBindGroup({
                layout: bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: paramsBuffer } },
                    { binding: 1, resource: { buffer: kernelBuffer } },
                    { binding: 2, resource: { buffer: inputBuffer } },
                    { binding: 3, resource: { buffer: tempBuffer } },
                ],
            });
            const verticalBindGroup = device.createBindGroup({
                layout: bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: paramsBuffer } },
                    { binding: 1, resource: { buffer: kernelBuffer } },
                    { binding: 2, resource: { buffer: tempBuffer } },
                    { binding: 3, resource: { buffer: outputBuffer } },
                ],
            });
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
            commandEncoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, bufferSize);
            device.queue.submit([commandEncoder.finish()]);
            await stagingBuffer.mapAsync(GPUMapMode.READ);
            const resultData = new Float32Array(stagingBuffer.getMappedRange().slice(0));
            stagingBuffer.unmap();
            return { data: resultData, width, height };
        }
        finally {
            // Always release per-call resources, even if a pass or readback
            // throws, so concurrent/repeated calls don't leak GPU memory.
            paramsBuffer.destroy();
            kernelBuffer.destroy();
            inputBuffer.destroy();
            tempBuffer.destroy();
            outputBuffer.destroy();
            stagingBuffer.destroy();
        }
    }
    /**
     * dispose() no longer needs to clean up shared buffers -- only the
     * cached pipeline/layout resources from initResources() remain.
     */
    dispose() { }
}
exports.WebGPUIsotropicBlur = WebGPUIsotropicBlur;
/**
 * Backend-agnostic isotropic blur. Picks the best backend this device
 * actually supports for *this algorithm* (not a global session-wide
 * choice), and falls back to the next-best backend if the active one
 * fails mid-session (lost context, driver crash, etc.).
 *
 * Construction is async (`IsotropicBlur.create()`) because backend
 * detection is inherently async; constructors can't be async, so a
 * private constructor plus a static factory forces detection to
 * complete before the instance is usable.
 */
class IsotropicBlur {
    instance;
    currentCtor;
    config;
    failedBackends = new Set();
    constructor(instance, currentCtor, config) {
        this.instance = instance;
        this.currentCtor = currentCtor;
        this.config = config;
    }
    // Ordered best-to-worst. `satisfies` (not `implements`) catches a
    // backend missing isSupported() or the instance shape at this line,
    // rather than failing silently or only at a call site deep inside.
    static candidates = [
        WebGPUIsotropicBlur,
        WebGLIsotropicBlur,
        CPUIsotropicBlur,
    ];
    static async create(config = {}) {
        for (const Ctor of IsotropicBlur.candidates) {
            if (await Ctor.isSupported()) {
                try {
                    return new IsotropicBlur(new Ctor(config), Ctor, config);
                }
                catch {
                    continue; // isSupported() lied; try the next candidate
                }
            }
        }
        throw new Error('No supported blur implementation available');
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
     * Demotes the current backend and activates the next untried, supported
     * candidate. A single-step retry, not a cascading loop through every
     * remaining backend: cascading on one call risks masking a real input
     * bug (e.g. a bad sigma) as a backend problem.
     *
     * `failedBackends` is per-instance, not module-global — a transient
     * driver hiccup shouldn't permanently blacklist a backend for the whole
     * session.
     */
    async demoteAndFindNext() {
        this.failedBackends.add(this.currentCtor);
        this.instance.dispose();
        for (const Ctor of IsotropicBlur.candidates) {
            if (this.failedBackends.has(Ctor))
                continue;
            if (await Ctor.isSupported()) {
                try {
                    this.instance = new Ctor(this.config);
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
exports.IsotropicBlur = IsotropicBlur;
//# sourceMappingURL=isotropic.js.map