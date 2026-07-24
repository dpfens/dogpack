"use strict";
/**
 * WebGPU-accelerated preprocessing module for XDoG/FDoG
 *
 * Even faster than WebGL implementations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GPUPreprocessingPipeline = exports.GPUPreprocessingPresets = exports.GPUQuantizer = exports.GPUContrastEnhancer = exports.GPUGaussianBlur = exports.GPUKuwaharaFilter = exports.GPUMedianFilter = exports.GPUBilateralFilter = void 0;
exports.getWebGPUUnsupportedReason = getWebGPUUnsupportedReason;
exports.disposeWebGPU = disposeWebGPU;
exports.clearShaderCaches = clearShaderCaches;
const base_js_1 = require("../../base.js");
const bilateral_wgsl_js_1 = require("./shaders/webgpu/bilateral.wgsl.js");
const kuwahara_wgsl_js_1 = require("./shaders/webgpu/kuwahara.wgsl.js");
const gaussian_wgsl_js_1 = require("./shaders/webgpu/gaussian.wgsl.js");
const histogram_wgsl_js_1 = require("./shaders/webgpu/histogram.wgsl.js");
const stretch_wgsl_js_1 = require("./shaders/webgpu/stretch.wgsl.js");
const quantize_wgsl_js_1 = require("./shaders/webgpu/quantize.wgsl.js");
const median_wgsl_js_1 = require("./shaders/webgpu/median.wgsl.js");
const device_js_1 = require("../../utils/device.js");
const math_js_1 = require("../../utils/math.js");
/* ==================================================================== */
/* GPU device management                                                */
/* ==================================================================== */
let cachedDevice = null;
let deviceInitPromise = null;
/**
 * Deeper async check: confirms an adapter is actually obtainable, not
 * just that `navigator.gpu` exists.
 */
async function getWebGPUUnsupportedReason() {
    if (typeof navigator === 'undefined' || !navigator.gpu) {
        return 'navigator.gpu is not available in this environment';
    }
    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            return 'No suitable GPU adapter was found';
        }
    }
    catch (err) {
        return `Failed to request a GPU adapter: ${err.message}`;
    }
    return undefined;
}
async function getWebGPUDevice() {
    if (cachedDevice)
        return cachedDevice;
    if (deviceInitPromise)
        return deviceInitPromise;
    deviceInitPromise = (async () => {
        if (!(0, device_js_1.isWebGLComputeSupported)()) {
            throw new Error('WebGPU is not supported in this environment (navigator.gpu is missing)');
        }
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            throw new Error('Failed to acquire a WebGPU adapter');
        }
        const device = await adapter.requestDevice();
        device.lost.then((info) => {
            // Invalidate the cache so the next call reinitializes a fresh device.
            cachedDevice = null;
            deviceInitPromise = null;
            clearShaderCaches();
            console.warn(`WebGPU device lost: ${info.message}`);
        });
        cachedDevice = device;
        return device;
    })();
    return deviceInitPromise;
}
/** Release the cached device. Mainly useful for tests / hot reload. */
function disposeWebGPU() {
    cachedDevice?.destroy();
    cachedDevice = null;
    deviceInitPromise = null;
}
/* ==================================================================== */
/* Low-level GPU helpers                                                 */
/* ==================================================================== */
const WORKGROUP_SIZE = 8;
function workgroupCount(size) {
    return Math.ceil(size / WORKGROUP_SIZE);
}
function createUniformBuffer(device, data) {
    const buffer = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data));
    buffer.unmap();
    return buffer;
}
function createReadOnlyStorageBuffer(device, data) {
    const buffer = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
}
function createOutputStorageBuffer(device, byteLength) {
    return device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
}
async function readFloat32Buffer(device, buffer, length) {
    const byteLength = length * 4;
    const staging = device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(buffer, 0, staging, 0, byteLength);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const copy = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return copy;
}
// Shader modules are cached by cacheKey so pipelines that share a module
// (e.g. the two Gaussian blur passes) don't recompile it twice.
const moduleCache = new Map();
const pipelineCache = new Map();
function getShaderModule(device, cacheKey, code) {
    let module = moduleCache.get(cacheKey);
    if (!module) {
        module = device.createShaderModule({ code });
        moduleCache.set(cacheKey, module);
    }
    return module;
}
// in webgpu.ts, near moduleCache/pipelineCache
function clearShaderCaches() {
    moduleCache.clear();
    pipelineCache.clear();
}
function getPipeline(device, cacheKey, code, entryPoint) {
    const key = `${cacheKey}::${entryPoint}`;
    let pipeline = pipelineCache.get(key);
    if (!pipeline) {
        const module = getShaderModule(device, cacheKey, code);
        pipeline = device.createComputePipeline({
            layout: 'auto',
            compute: { module, entryPoint, constants: { WORKGROUP_SIZE } },
        });
        pipelineCache.set(key, pipeline);
    }
    return pipeline;
}
function dispatch(device, pipeline, bindGroup, width, height) {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupCount(width), workgroupCount(height));
    pass.end();
    device.queue.submit([encoder.finish()]);
}
/* ==================================================================== */
/* Bilateral Filter                                                      */
/* ==================================================================== */
const DEFAULT_BILATERAL_CONFIG = {
    sigmaSpatial: 3,
    sigmaRange: 0.1,
    radiusMultiplier: 2,
};
/**
 * The `rowOffset` field lets a single dispatch cover only a band of rows
 * of a much taller image (see the chunking loop in `process()` below).
 * `spatialWeights` is a precomputed (2*radius+1)^2 lookup table for the
 * spatial term of the bilateral weight, which depends only on (dx, dy)
 * and is identical for every pixel — computing it on the CPU once instead
 * of calling `exp()` for it on every shader invocation roughly halves the
 * transcendental-function work in the inner loop.
 */
class GPUBilateralFilter extends base_js_1.BaseWebGPUStrategy {
    config;
    static async isSupported() {
        return (0, device_js_1.isWebGLComputeSupported)() && (await getWebGPUUnsupportedReason()) === undefined;
    }
    static getUnsupportedReason() {
        return getWebGPUUnsupportedReason();
    }
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_BILATERAL_CONFIG, ...config };
    }
    async process(input) {
        const device = await getWebGPUDevice();
        const { width, height } = input;
        const cfg = this.config;
        const radius = Math.ceil(cfg.sigmaSpatial * (cfg.radiusMultiplier ?? 2));
        const side = 2 * radius + 1;
        if (radius > 15) {
            console.warn(`GPUBilateralFilter: radius=${radius} (from sigmaSpatial=${cfg.sigmaSpatial}) means ` +
                `${side * side} samples/pixel. On large images this can still be expensive enough ` +
                `to run long even chunked; consider a smaller sigmaSpatial/radiusMultiplier if you ` +
                `see slowdowns or device loss.`);
        }
        // Precompute the spatial weight term (depends only on dx, dy - identical
        // for every pixel) once on the CPU instead of recomputing it with exp()
        // on every shader invocation for every pixel.
        const spatialLUT = new Float32Array(side * side);
        {
            const sigmaSpatial2 = 2 * cfg.sigmaSpatial * cfg.sigmaSpatial;
            let li = 0;
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    spatialLUT[li++] = Math.exp(-(dx * dx + dy * dy) / sigmaSpatial2);
                }
            }
        }
        const uniformData = new ArrayBuffer(32);
        const u32View = new Uint32Array(uniformData);
        const f32View = new Float32Array(uniformData);
        u32View[0] = width;
        u32View[1] = height;
        u32View[2] = radius;
        u32View[3] = 0; // rowOffset - updated per chunk in the loop below
        f32View[4] = 2 * cfg.sigmaSpatial * cfg.sigmaSpatial;
        f32View[5] = 2 * cfg.sigmaRange * cfg.sigmaRange;
        return this.runGuarded(device, async () => {
            const uniformBuffer = createUniformBuffer(device, uniformData);
            const inputBuffer = createReadOnlyStorageBuffer(device, input.data);
            const outputBuffer = createOutputStorageBuffer(device, input.data.byteLength);
            const spatialWeightsBuffer = createReadOnlyStorageBuffer(device, spatialLUT);
            const pipeline = getPipeline(device, 'bilateral', bilateral_wgsl_js_1.default, 'main');
            const bindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: inputBuffer } },
                    { binding: 2, resource: { buffer: outputBuffer } },
                    { binding: 3, resource: { buffer: spatialWeightsBuffer } },
                ],
            });
            // Large images combined with large radii make width * height *
            // (2*radius+1)^2 samples in a single dispatch, which can run long
            // enough to exceed the GPU driver's watchdog timeout and bring down
            // the whole device (VK_ERROR_DEVICE_LOST) instead of just failing
            // this operation. Splitting the work into row bands, each submitted
            // and awaited independently, keeps any single submission short.
            // ROWS_PER_CHUNK is sized so that each chunk does roughly the same
            // amount of total sampling work regardless of image width or radius.
            const ROWS_PER_CHUNK = Math.max(1, Math.floor(4_000_000 / (width * side * side)));
            for (let y0 = 0; y0 < height; y0 += ROWS_PER_CHUNK) {
                const rows = Math.min(ROWS_PER_CHUNK, height - y0);
                device.queue.writeBuffer(uniformBuffer, 12, new Uint32Array([y0]));
                const encoder = device.createCommandEncoder();
                const pass = encoder.beginComputePass();
                pass.setPipeline(pipeline);
                pass.setBindGroup(0, bindGroup);
                pass.dispatchWorkgroups(workgroupCount(width), workgroupCount(rows));
                pass.end();
                device.queue.submit([encoder.finish()]);
                // Wait for this chunk before queuing the next one, so the driver
                // never has more than one chunk's worth of work pending at once.
                await device.queue.onSubmittedWorkDone();
            }
            const resultData = await readFloat32Buffer(device, outputBuffer, width * height);
            uniformBuffer.destroy();
            inputBuffer.destroy();
            outputBuffer.destroy();
            spatialWeightsBuffer.destroy();
            return { data: resultData, width, height };
        });
    }
}
exports.GPUBilateralFilter = GPUBilateralFilter;
/* ==================================================================== */
/* Median Filter                                                         */
/* ==================================================================== */
const DEFAULT_MEDIAN_CONFIG = {
    radius: 2,
};
// N (the per-pixel neighborhood size) sizes a function-local `var`, not a
// `var<workgroup>` one, so it can't become a WGSL `override` — the
// override-as-array-size exception only covers workgroup-address-space
// arrays (see median.wgsl's comment for the full explanation). It's a
// genuine `const`, so it still has to be baked per radius at the string
// level; a new shader module is compiled (and cached by getPipeline's
// cacheKey) for each distinct radius, same as before this migration.
function medianShaderSource(radius) {
    const side = 2 * radius + 1;
    const n = side * side;
    return median_wgsl_js_1.default.replace('__N__', String(n));
}
class GPUMedianFilter extends base_js_1.BaseWebGPUStrategy {
    config;
    static async isSupported() {
        return (0, device_js_1.isWebGLComputeSupported)() && (await getWebGPUUnsupportedReason()) === undefined;
    }
    static getUnsupportedReason() {
        return getWebGPUUnsupportedReason();
    }
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_MEDIAN_CONFIG, ...config };
        if (this.config.radius > 6) {
            console.warn(`GPUMedianFilter: radius=${this.config.radius} means a per-pixel ` +
                `neighborhood array of ${(2 * this.config.radius + 1) ** 2} elements, ` +
                `sorted in-shader with an O(n^2) insertion sort. This can get slow ` +
                `and register-heavy fast; consider a smaller radius on GPU.`);
        }
    }
    async process(input) {
        const device = await getWebGPUDevice();
        const { width, height } = input;
        const radius = this.config.radius;
        const uniformData = new ArrayBuffer(16);
        const u32View = new Uint32Array(uniformData);
        u32View[0] = width;
        u32View[1] = height;
        u32View[2] = radius;
        return this.runGuarded(device, async () => {
            const uniformBuffer = createUniformBuffer(device, uniformData);
            const inputBuffer = createReadOnlyStorageBuffer(device, input.data);
            const outputBuffer = createOutputStorageBuffer(device, input.data.byteLength);
            const cacheKey = `median-r${radius}`;
            const pipeline = getPipeline(device, cacheKey, medianShaderSource(radius), 'main');
            const bindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: inputBuffer } },
                    { binding: 2, resource: { buffer: outputBuffer } },
                ],
            });
            dispatch(device, pipeline, bindGroup, width, height);
            const resultData = await readFloat32Buffer(device, outputBuffer, width * height);
            uniformBuffer.destroy();
            inputBuffer.destroy();
            outputBuffer.destroy();
            return { data: resultData, width, height };
        });
    }
}
exports.GPUMedianFilter = GPUMedianFilter;
/* ==================================================================== */
/* Kuwahara Filter                                                       */
/* ==================================================================== */
const DEFAULT_KUWAHARA_CONFIG = {
    radius: 3,
};
class GPUKuwaharaFilter extends base_js_1.BaseWebGPUStrategy {
    config;
    static async isSupported() {
        return (0, device_js_1.isWebGLComputeSupported)() && (await getWebGPUUnsupportedReason()) === undefined;
    }
    static getUnsupportedReason() {
        return getWebGPUUnsupportedReason();
    }
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_KUWAHARA_CONFIG, ...config };
    }
    async process(input) {
        const device = await getWebGPUDevice();
        const { width, height } = input;
        const radius = this.config.radius;
        const uniformData = new ArrayBuffer(16);
        const u32View = new Uint32Array(uniformData);
        u32View[0] = width;
        u32View[1] = height;
        u32View[2] = radius;
        return this.runGuarded(device, async () => {
            const uniformBuffer = createUniformBuffer(device, uniformData);
            const inputBuffer = createReadOnlyStorageBuffer(device, input.data);
            const outputBuffer = createOutputStorageBuffer(device, input.data.byteLength);
            const pipeline = getPipeline(device, 'kuwahara', kuwahara_wgsl_js_1.default, 'main');
            const bindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: inputBuffer } },
                    { binding: 2, resource: { buffer: outputBuffer } },
                ],
            });
            dispatch(device, pipeline, bindGroup, width, height);
            const resultData = await readFloat32Buffer(device, outputBuffer, width * height);
            uniformBuffer.destroy();
            inputBuffer.destroy();
            outputBuffer.destroy();
            return { data: resultData, width, height };
        });
    }
}
exports.GPUKuwaharaFilter = GPUKuwaharaFilter;
/* ==================================================================== */
/* Gaussian Blur (separable, two compute passes)                        */
/* ==================================================================== */
class GPUGaussianBlur extends base_js_1.BaseWebGPUStrategy {
    sigma;
    static async isSupported() {
        return (0, device_js_1.isWebGLComputeSupported)() && (await getWebGPUUnsupportedReason()) === undefined;
    }
    static getUnsupportedReason() {
        return getWebGPUUnsupportedReason();
    }
    constructor(sigma = 1.0) {
        super();
        this.sigma = sigma;
    }
    async process(input) {
        const { width, height } = input;
        if (this.sigma < 0.1) {
            return { data: new Float32Array(input.data), width, height };
        }
        const device = await getWebGPUDevice();
        const radius = Math.ceil(this.sigma * 3);
        const kernelSize = radius * 2 + 1;
        const kernel = (0, math_js_1.generateGaussianKernel)(this.sigma, kernelSize);
        const uniformData = new ArrayBuffer(16);
        const u32View = new Uint32Array(uniformData);
        u32View[0] = width;
        u32View[1] = height;
        u32View[2] = radius;
        return this.runGuarded(device, async () => {
            const uniformBuffer = createUniformBuffer(device, uniformData);
            const inputBuffer = createReadOnlyStorageBuffer(device, input.data);
            const kernelBuffer = createReadOnlyStorageBuffer(device, new Float32Array(kernel));
            const tempBuffer = createOutputStorageBuffer(device, input.data.byteLength);
            const outputBuffer = createOutputStorageBuffer(device, input.data.byteLength);
            const pipelineH = getPipeline(device, 'gaussian', gaussian_wgsl_js_1.default, 'main_h');
            const pipelineV = getPipeline(device, 'gaussian', gaussian_wgsl_js_1.default, 'main_v');
            const bindGroupH = device.createBindGroup({
                layout: pipelineH.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: inputBuffer } },
                    { binding: 2, resource: { buffer: kernelBuffer } },
                    { binding: 3, resource: { buffer: tempBuffer } },
                ],
            });
            const bindGroupV = device.createBindGroup({
                layout: pipelineV.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: tempBuffer } },
                    { binding: 2, resource: { buffer: kernelBuffer } },
                    { binding: 3, resource: { buffer: outputBuffer } },
                ],
            });
            // Both passes are recorded on one command encoder before submission,
            // so the vertical pass reliably waits for the horizontal pass's writes
            // to tempBuffer (WebGPU commands within one queue submission execute
            // in program order with respect to buffer dependencies).
            const encoder = device.createCommandEncoder();
            let pass = encoder.beginComputePass();
            pass.setPipeline(pipelineH);
            pass.setBindGroup(0, bindGroupH);
            pass.dispatchWorkgroups(workgroupCount(width), workgroupCount(height));
            pass.end();
            pass = encoder.beginComputePass();
            pass.setPipeline(pipelineV);
            pass.setBindGroup(0, bindGroupV);
            pass.dispatchWorkgroups(workgroupCount(width), workgroupCount(height));
            pass.end();
            device.queue.submit([encoder.finish()]);
            const resultData = await readFloat32Buffer(device, outputBuffer, width * height);
            uniformBuffer.destroy();
            inputBuffer.destroy();
            kernelBuffer.destroy();
            tempBuffer.destroy();
            outputBuffer.destroy();
            return { data: resultData, width, height };
        });
    }
}
exports.GPUGaussianBlur = GPUGaussianBlur;
/* ==================================================================== */
/* Contrast Enhancement (histogram-based percentile approximation)      */
/* ==================================================================== */
class GPUContrastEnhancer extends base_js_1.BaseWebGPUStrategy {
    blackPoint;
    whitePoint;
    static async isSupported() {
        return (0, device_js_1.isWebGLComputeSupported)() && (await getWebGPUUnsupportedReason()) === undefined;
    }
    static getUnsupportedReason() {
        return getWebGPUUnsupportedReason();
    }
    constructor(blackPoint = 0.01, whitePoint = 0.99) {
        super();
        this.blackPoint = blackPoint;
        this.whitePoint = whitePoint;
    }
    /**
     * The CPU version sorts every pixel to find exact percentiles. Sorting
     * is a poor fit for a GPU compute pass, so this builds a 256-bin
     * histogram instead (one atomicAdd per pixel), reads the 1KB histogram
     * back to the CPU to locate the percentile bins, then runs a second,
     * fully GPU-resident pass to apply the stretch. This trades a small
     * amount of precision (bin width 1/255) for O(n) work instead of an
     * O(n log n) sort, at the cost of one small CPU/GPU sync point.
     *
     * The two GPU round-trips (histogram pass, then stretch pass) are each
     * wrapped in their own runGuarded scope rather than one scope spanning
     * both — the CPU-side histogram bucketing that happens between them
     * isn't GPU work, so it shouldn't sit inside a WebGPU error scope.
     */
    async process(input) {
        const device = await getWebGPUDevice();
        const { width, height } = input;
        const size = width * height;
        const histUniform = new ArrayBuffer(16);
        new Uint32Array(histUniform).set([width, height, 0, 0]);
        const histogramU32 = await this.runGuarded(device, async () => {
            const histUniformBuffer = createUniformBuffer(device, histUniform);
            const histInputBuffer = createReadOnlyStorageBuffer(device, input.data);
            const histogramBuffer = device.createBuffer({
                size: 256 * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
            });
            device.queue.writeBuffer(histogramBuffer, 0, new Uint32Array(256));
            const histPipeline = getPipeline(device, 'histogram', histogram_wgsl_js_1.default, 'main');
            const histBindGroup = device.createBindGroup({
                layout: histPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: histUniformBuffer } },
                    { binding: 1, resource: { buffer: histInputBuffer } },
                    { binding: 2, resource: { buffer: histogramBuffer } },
                ],
            });
            dispatch(device, histPipeline, histBindGroup, width, height);
            const result = await readUint32Buffer(device, histogramBuffer, 256);
            histUniformBuffer.destroy();
            histInputBuffer.destroy();
            histogramBuffer.destroy();
            return result;
        });
        const blackCount = this.blackPoint * size;
        const whiteCount = this.whitePoint * size;
        let cumulative = 0;
        let minBin = 0;
        let maxBin = 255;
        let foundMin = false;
        for (let bin = 0; bin < 256; bin++) {
            cumulative += histogramU32[bin];
            if (!foundMin && cumulative >= blackCount) {
                minBin = bin;
                foundMin = true;
            }
            if (cumulative >= whiteCount) {
                maxBin = bin;
                break;
            }
        }
        const minVal = minBin / 255;
        const maxVal = maxBin / 255;
        const range = maxVal - minVal;
        if (range < 0.01) {
            return { data: new Float32Array(input.data), width, height };
        }
        const stretchUniform = new ArrayBuffer(16);
        const stretchU32 = new Uint32Array(stretchUniform);
        const stretchF32 = new Float32Array(stretchUniform);
        stretchU32[0] = width;
        stretchU32[1] = height;
        stretchF32[2] = minVal;
        stretchF32[3] = range;
        return this.runGuarded(device, async () => {
            const stretchUniformBuffer = createUniformBuffer(device, stretchUniform);
            const stretchInputBuffer = createReadOnlyStorageBuffer(device, input.data);
            const outputBuffer = createOutputStorageBuffer(device, input.data.byteLength);
            const stretchPipeline = getPipeline(device, 'stretch', stretch_wgsl_js_1.default, 'main');
            const stretchBindGroup = device.createBindGroup({
                layout: stretchPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: stretchUniformBuffer } },
                    { binding: 1, resource: { buffer: stretchInputBuffer } },
                    { binding: 2, resource: { buffer: outputBuffer } },
                ],
            });
            dispatch(device, stretchPipeline, stretchBindGroup, width, height);
            const resultData = await readFloat32Buffer(device, outputBuffer, width * height);
            stretchUniformBuffer.destroy();
            stretchInputBuffer.destroy();
            outputBuffer.destroy();
            return { data: resultData, width, height };
        });
    }
}
exports.GPUContrastEnhancer = GPUContrastEnhancer;
async function readUint32Buffer(device, buffer, length) {
    const byteLength = length * 4;
    const staging = device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(buffer, 0, staging, 0, byteLength);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const copy = new Uint32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return copy;
}
/* ==================================================================== */
/* Quantizer                                                             */
/* ==================================================================== */
class GPUQuantizer extends base_js_1.BaseWebGPUStrategy {
    levels;
    static async isSupported() {
        return (0, device_js_1.isWebGLComputeSupported)() && (await getWebGPUUnsupportedReason()) === undefined;
    }
    static getUnsupportedReason() {
        return getWebGPUUnsupportedReason();
    }
    constructor(levels = 8) {
        super();
        this.levels = levels;
    }
    async process(input) {
        const device = await getWebGPUDevice();
        const { width, height } = input;
        const step = 1 / (this.levels - 1);
        const uniformData = new ArrayBuffer(16);
        const u32View = new Uint32Array(uniformData);
        const f32View = new Float32Array(uniformData);
        u32View[0] = width;
        u32View[1] = height;
        f32View[2] = step;
        return this.runGuarded(device, async () => {
            const uniformBuffer = createUniformBuffer(device, uniformData);
            const inputBuffer = createReadOnlyStorageBuffer(device, input.data);
            const outputBuffer = createOutputStorageBuffer(device, input.data.byteLength);
            const pipeline = getPipeline(device, 'quantize', quantize_wgsl_js_1.default, 'main');
            const bindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: inputBuffer } },
                    { binding: 2, resource: { buffer: outputBuffer } },
                ],
            });
            dispatch(device, pipeline, bindGroup, width, height);
            const resultData = await readFloat32Buffer(device, outputBuffer, width * height);
            uniformBuffer.destroy();
            inputBuffer.destroy();
            outputBuffer.destroy();
            return { data: resultData, width, height };
        });
    }
}
exports.GPUQuantizer = GPUQuantizer;
/* ==================================================================== */
/* Presets and pipeline (async-native equivalents of cpu.ts's)           */
/* ==================================================================== */
/**
 * Preset preprocessing pipelines for common use cases — async GPU
 * equivalents of `PreprocessingPresets` in cpu.ts.
 */
exports.GPUPreprocessingPresets = {
    /** Light preprocessing - minimal smoothing. Good for clean studio photos, illustrations. */
    light: (input) => new GPUBilateralFilter({ sigmaSpatial: 2, sigmaRange: 0.08 }).process(input),
    /** Standard preprocessing - balanced smoothing. Good for most outdoor photos, portraits. */
    standard: (input) => new GPUBilateralFilter({ sigmaSpatial: 4, sigmaRange: 0.1 }).process(input),
    /** Heavy preprocessing - aggressive noise removal. Good for very textured images. */
    heavy: async (input) => {
        let result = await new GPUBilateralFilter({ sigmaSpatial: 5, sigmaRange: 0.12 }).process(input);
        result = await new GPUBilateralFilter({ sigmaSpatial: 3, sigmaRange: 0.1 }).process(result);
        return result;
    },
    /** Artistic preprocessing - painterly smoothing. Good for stylized/artistic output. */
    artistic: async (input) => {
        let result = await new GPUKuwaharaFilter({ radius: 4 }).process(input);
        result = await new GPUBilateralFilter({ sigmaSpatial: 2, sigmaRange: 0.08 }).process(result);
        return result;
    },
    /** Photo preprocessing - for photos with grass/nature. Good for landscape, outdoor scenes. */
    nature: async (input) => {
        let result = await new GPUBilateralFilter({ sigmaSpatial: 6, sigmaRange: 0.15 }).process(input);
        result = await new GPUBilateralFilter({ sigmaSpatial: 3, sigmaRange: 0.08 }).process(result);
        return result;
    },
};
/**
 * Convenience class for chaining GPU preprocessing operations — async
 * equivalent of `PreprocessingPipeline` in cpu.ts.
 */
class GPUPreprocessingPipeline {
    operations = [];
    bilateral(config) {
        this.operations.push(new GPUBilateralFilter(config));
        return this;
    }
    median(config) {
        this.operations.push(new GPUMedianFilter(config));
        return this;
    }
    kuwahara(config) {
        this.operations.push(new GPUKuwaharaFilter(config));
        return this;
    }
    gaussian(sigma) {
        this.operations.push(new GPUGaussianBlur(sigma));
        return this;
    }
    contrast(blackPoint, whitePoint) {
        this.operations.push(new GPUContrastEnhancer(blackPoint, whitePoint));
        return this;
    }
    quantize(levels) {
        this.operations.push(new GPUQuantizer(levels));
        return this;
    }
    /** Add an arbitrary custom async preprocessing strategy to the pipeline. */
    use(preprocessor) {
        this.operations.push(preprocessor);
        return this;
    }
    /** Apply all operations in sequence, awaiting each GPU round-trip. */
    async apply(input) {
        let result = input;
        for (const op of this.operations) {
            result = await op.process(result);
        }
        return result;
    }
    clear() {
        this.operations = [];
        return this;
    }
}
exports.GPUPreprocessingPipeline = GPUPreprocessingPipeline;
//# sourceMappingURL=webgpu.js.map