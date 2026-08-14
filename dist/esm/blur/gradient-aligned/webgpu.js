/**
 * WebGPU-accelerated gradient-aligned blur for FDoG
 *
 * Compute-shader version of the same perpendicular-to-flow sampling as
 * CPUGradientAlignedBlur / WebGLGradientAlignedBlur.
 *
 */
import { DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG, } from '../../interfaces/base.js';
import { createChannelImage } from '../../utils/image.js';
import { generateGaussianKernel } from '../../utils/math.js';
import FRAGMENT_SOURCE from '../shaders/gradient-aligned/webgpu-fragment.wgsl.js';
const MAX_SAMPLES = 256;
const WORKGROUP_SIZE = 8;
export class WebGPUGradientAlignedBlur {
    backend = 'webgpu';
    config;
    device;
    pipeline;
    flowField;
    static cachedDevice = null;
    static deviceInitPromise = null;
    static lastUnsupportedReason;
    static errorListenerAttached = false;
    flowTexture = null;
    flowFieldWidth = 0;
    flowFieldHeight = 0;
    flowDirty = true;
    flowBakePromise = null;
    maxTileBytes = 0;
    static CPU_BAKE_ROWS_PER_CHUNK = 512;
    static TILE_MEMORY_SAFETY_FACTOR = 0.5;
    constructor(config) {
        const device = WebGPUGradientAlignedBlur.cachedDevice;
        if (!device) {
            throw new Error('[GradientAlignedBlur/WebGPU] No cached GPUDevice. isSupported() must resolve true before construction.');
        }
        this.flowField = config.flowField;
        this.device = device;
        this.config = { ...DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG, ...config };
        this.initPipeline();
        const limits = this.device.limits;
        this.maxTileBytes = Math.max(WORKGROUP_SIZE * 4, // never go below one row's worth of data
        Math.floor(Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize) *
            WebGPUGradientAlignedBlur.TILE_MEMORY_SAFETY_FACTOR));
        if (!WebGPUGradientAlignedBlur.errorListenerAttached) {
            WebGPUGradientAlignedBlur.errorListenerAttached = true;
            this.device.addEventListener('uncapturederror', (event) => {
                console.error('[GradientAlignedBlur/WebGPU] uncaptured GPU error:', event.error?.message ?? event.error);
            });
        }
    }
    /**
     * Acquires (and caches) the shared GPUDevice. Concurrent callers await
     * the same in-flight request rather than each requesting their own
     * adapter/device. Re-acquires automatically after a `device.lost` clears
     * the cache.
     */
    static async acquireDevice() {
        if (WebGPUGradientAlignedBlur.cachedDevice) {
            return WebGPUGradientAlignedBlur.cachedDevice;
        }
        if (WebGPUGradientAlignedBlur.deviceInitPromise) {
            return WebGPUGradientAlignedBlur.deviceInitPromise;
        }
        WebGPUGradientAlignedBlur.deviceInitPromise = (async () => {
            if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
                throw new Error('[GradientAlignedBlur/WebGPU] navigator.gpu unavailable');
            }
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                throw new Error('[GradientAlignedBlur/WebGPU] No adapter available');
            }
            // Explicitly request the adapter's actual max limits rather than
            // accepting the (often much lower) spec-minimum defaults (e.g. the
            // default maxBufferSize/maxStorageBufferBindingSize are commonly
            // 256MB/128MB, but many adapters support several times that).
            const device = await adapter.requestDevice({
                requiredLimits: {
                    maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
                },
            });
            device.lost.then((info) => {
                console.warn('[GradientAlignedBlur/WebGPU] device lost:', info.message);
                if (WebGPUGradientAlignedBlur.cachedDevice === device) {
                    WebGPUGradientAlignedBlur.cachedDevice = null;
                    WebGPUGradientAlignedBlur.errorListenerAttached = false;
                }
            });
            WebGPUGradientAlignedBlur.cachedDevice = device;
            return device;
        })();
        try {
            return await WebGPUGradientAlignedBlur.deviceInitPromise;
        }
        finally {
            WebGPUGradientAlignedBlur.deviceInitPromise = null;
        }
    }
    static async isSupported() {
        try {
            await WebGPUGradientAlignedBlur.acquireDevice();
            return true;
        }
        catch (err) {
            WebGPUGradientAlignedBlur.lastUnsupportedReason =
                err instanceof Error ? err.message : String(err);
            return false;
        }
    }
    static getUnsupportedReason() {
        return WebGPUGradientAlignedBlur.lastUnsupportedReason;
    }
    initPipeline() {
        const module = this.device.createShaderModule({ code: FRAGMENT_SOURCE });
        this.pipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module, entryPoint: 'main' },
        });
    }
    setFlowField(flowField) {
        this.flowField = flowField;
        this.flowDirty = true;
    }
    assertWithinTextureLimits(width, height) {
        const maxDim = this.device.limits.maxTextureDimension2D;
        if (width > maxDim || height > maxDim) {
            throw new Error(`[GradientAlignedBlur/WebGPU] Image ${width}x${height} exceeds this device's ` +
                `maxTextureDimension2D (${maxDim}) on at least one axis. The input/flow textures ` +
                `are each a single full-image texture, so this can't be worked around by row-band ` +
                `tiling alone (that only bounds the output/readback buffers). Downscale the image, ` +
                `or split it into overlapping regions upstream and blur each region separately.`);
        }
    }
    /**
     * Releases this instance's own GPU resources (flow texture). Deliberately
     * does NOT destroy `this.device`. The device is shared/cached at the
     * class level (see file header), and other instances (or a future
     * instance created after a fallback-and-retry) may still be using it.
     * If you need to fully release the device (e.g. on app shutdown), that's
     * out of scope for a per-instance dispose() and would need an explicit
     * class-level teardown method instead.
     */
    dispose() {
        this.flowTexture?.destroy();
    }
    bakeFlowTexture(width, height) {
        this.assertWithinTextureLimits(width, height);
        const newTexture = this.device.createTexture({
            size: [width, height],
            format: 'rg32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        const rowsPerChunk = Math.max(1, WebGPUGradientAlignedBlur.CPU_BAKE_ROWS_PER_CHUNK);
        for (let y0 = 0; y0 < height; y0 += rowsPerChunk) {
            const rows = Math.min(rowsPerChunk, height - y0);
            const chunk = new Float32Array(width * rows * 2);
            for (let ry = 0; ry < rows; ry++) {
                const y = y0 + ry;
                for (let x = 0; x < width; x++) {
                    const tangent = this.flowField.getTangent(x, y);
                    const idx = (ry * width + x) * 2;
                    chunk[idx] = -tangent.y; // perpendicular.x
                    chunk[idx + 1] = tangent.x; // perpendicular.y
                }
            }
            this.device.queue.writeTexture({ texture: newTexture, origin: { x: 0, y: y0 } }, chunk, { bytesPerRow: width * 2 * 4, rowsPerImage: rows }, { width, height: rows });
        }
        const oldTexture = this.flowTexture;
        this.flowTexture = newTexture;
        oldTexture?.destroy();
        this.flowFieldWidth = width;
        this.flowFieldHeight = height;
        this.flowDirty = false;
        return newTexture;
    }
    /**
     * Returns the current flow texture for (width, height), baking it if
     * necessary. Guarded so that concurrent blur() calls with matching
     * dimensions await a single in-flight bake instead of each triggering
     * their own (which would otherwise race on `this.flowTexture`).
     */
    async getFlowTexture(width, height) {
        if (this.flowTexture &&
            !this.flowDirty &&
            this.flowFieldWidth === width &&
            this.flowFieldHeight === height) {
            return this.flowTexture;
        }
        if (this.flowBakePromise) {
            await this.flowBakePromise;
            return this.getFlowTexture(width, height);
        }
        this.flowBakePromise = (async () => this.bakeFlowTexture(width, height))();
        try {
            return await this.flowBakePromise;
        }
        finally {
            this.flowBakePromise = null;
        }
    }
    /**
     * Safe to call concurrently on the same instance (e.g.
     * `Promise.all([blur.blur(input, s1), blur.blur(input, s2)])`).
     * All GPU resources that are written-then-read per invocation are
     * allocated fresh here and destroyed before returning, so overlapping
     * calls never share mutable state. The only cross-call state is the
     * (read-only, cached) flow texture, obtained via `getFlowTexture`,
     * which is itself lock-guarded against concurrent re-baking.
     *
     * MEMORY: the output/readback path is processed in row-band tiles
     * bounded by `maxTileBytes`, not one whole-image buffer. This is what
     * keeps memory flat for large images (and for concurrent calls on the
     * same image) instead of scaling linearly with width*height.
     * The input/flow textures are still
     * one full-image texture each; if width or height exceeds the device's
     * maxTextureDimension2D, `getFlowTexture`/this method throw a clear
     * error rather than silently corrupting or crashing (see
     * `assertWithinTextureLimits`).
     */
    async blur(input, sigma) {
        if (WebGPUGradientAlignedBlur.cachedDevice !== this.device) {
            throw new Error('[GradientAlignedBlur/WebGPU] device lost');
        }
        if (sigma < 0.1) {
            return { data: new Float32Array(input.data), width: input.width, height: input.height };
        }
        const { width, height } = input;
        this.assertWithinTextureLimits(width, height);
        const flowTexture = await this.getFlowTexture(width, height);
        const wantedHalfSamples = Math.ceil((sigma * 2) / this.config.stepSize);
        const halfSamples = Math.min(MAX_SAMPLES - 1, wantedHalfSamples);
        if (wantedHalfSamples > MAX_SAMPLES - 1) {
            console.warn(`[GradientAlignedBlur/WebGPU] halfSamples clamped to ${MAX_SAMPLES - 1} (sigma=${sigma} wanted ${wantedHalfSamples}); kernel truncated. Raise MAX_SAMPLES if this matters.`);
        }
        const numSamples = halfSamples * 2 + 1;
        const weights = generateGaussianKernel(sigma, numSamples);
        const paddedWeights = new Float32Array(MAX_SAMPLES);
        paddedWeights.set(weights);
        // Row-band tile plan. Only the output/readback buffers scale with
        // tile size. input/flow textures below are still whole-image.
        const bytesPerRow = width * 4;
        const rowsPerTile = Math.max(1, Math.min(height, Math.floor(this.maxTileBytes / bytesPerRow)));
        const inputTexture = this.device.createTexture({
            size: [width, height],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        const tileBufferSize = rowsPerTile * bytesPerRow;
        const outputBuffer = this.device.createBuffer({
            size: tileBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        const readBuffer = this.device.createBuffer({
            size: tileBufferSize,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const paramsBuffer = this.device.createBuffer({
            size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const weightsBuffer = this.device.createBuffer({
            size: MAX_SAMPLES * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        try {
            this.device.queue.writeTexture({ texture: inputTexture }, input.data, { bytesPerRow, rowsPerImage: height }, { width, height });
            this.device.queue.writeBuffer(weightsBuffer, 0, paddedWeights);
            const bindGroup = this.device.createBindGroup({
                layout: this.pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: paramsBuffer } },
                    { binding: 1, resource: { buffer: weightsBuffer } },
                    { binding: 2, resource: inputTexture.createView() },
                    { binding: 3, resource: flowTexture.createView() },
                    { binding: 4, resource: { buffer: outputBuffer } },
                ],
            });
            const output = createChannelImage(width, height);
            for (let rowOffset = 0; rowOffset < height; rowOffset += rowsPerTile) {
                const tileHeight = Math.min(rowsPerTile, height - rowOffset);
                const paramsData = new ArrayBuffer(32);
                const paramsView = new DataView(paramsData);
                paramsView.setUint32(0, width, true);
                paramsView.setUint32(4, height, true);
                paramsView.setUint32(8, halfSamples, true);
                paramsView.setFloat32(12, this.config.stepSize, true);
                paramsView.setUint32(16, rowOffset, true);
                paramsView.setUint32(20, tileHeight, true);
                this.device.queue.writeBuffer(paramsBuffer, 0, paramsData);
                const encoder = this.device.createCommandEncoder();
                const pass = encoder.beginComputePass();
                pass.setPipeline(this.pipeline);
                pass.setBindGroup(0, bindGroup);
                pass.dispatchWorkgroups(Math.ceil(width / WORKGROUP_SIZE), Math.ceil(tileHeight / WORKGROUP_SIZE));
                pass.end();
                encoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, tileHeight * bytesPerRow);
                this.device.queue.submit([encoder.finish()]);
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
            weightsBuffer.destroy();
        }
    }
}
//# sourceMappingURL=webgpu.js.map