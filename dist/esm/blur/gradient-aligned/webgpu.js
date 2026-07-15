/**
 * WebGPU-accelerated gradient-aligned blur for FDoG
 *
 * Compute-shader version of the same perpendicular-to-flow sampling as
 * CPUGradientAlignedBlur / WebGLGradientAlignedBlur.
 *
 */
import { DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG, } from '../../interfaces/base.js';
import { generateGaussianKernel, createChannelImage } from '../../utils/index.js';
const MAX_SAMPLES = 256;
const WORKGROUP_SIZE = 8;
const SHADER_SRC = `
struct Params {
  width: u32,
  height: u32,
  halfSamples: u32,
  stepSize: f32,
  rowOffset: u32,   // first global row this dispatch is responsible for
  tileHeight: u32,  // number of rows in this tile's output buffer
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> weights: array<f32, ${MAX_SAMPLES}>;
@group(0) @binding(2) var inputTex: texture_2d<f32>;
@group(0) @binding(3) var flowTex: texture_2d<f32>;
@group(0) @binding(4) var<storage, read_write> output: array<f32>;

fn fetchClamped(tex: texture_2d<f32>, x: i32, y: i32, w: i32, h: i32) -> f32 {
  let cx = clamp(x, 0, w - 1);
  let cy = clamp(y, 0, h - 1);
  return textureLoad(tex, vec2<i32>(cx, cy), 0).r;
}

fn sampleBilinear(tex: texture_2d<f32>, x: f32, y: f32, w: i32, h: i32) -> f32 {
  let x0 = i32(floor(x));
  let y0 = i32(floor(y));
  let x1 = x0 + 1;
  let y1 = y0 + 1;
  let fx = x - f32(x0);
  let fy = y - f32(y0);
  let v00 = fetchClamped(tex, x0, y0, w, h);
  let v10 = fetchClamped(tex, x1, y0, w, h);
  let v01 = fetchClamped(tex, x0, y1, w, h);
  let v11 = fetchClamped(tex, x1, y1, w, h);
  return v00 * (1.0 - fx) * (1.0 - fy) + v10 * fx * (1.0 - fy)
       + v01 * (1.0 - fx) * fy + v11 * fx * fy;
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = i32(params.width);
  let h = i32(params.height);
  let localY = i32(gid.y);
  // Bounds-check against this tile's height (buffer is sized per-tile,
  // not per-image) before doing anything else.
  if (i32(gid.x) >= w || localY >= i32(params.tileHeight)) {
    return;
  }
  let globalY = localY + i32(params.rowOffset);
  if (globalY >= h) {
    return;
  }

  let px0 = f32(gid.x);
  let py0 = f32(globalY);
  // Flow direction only ever sampled at integer pixel centers on the CPU
  // path, so nearest-load (no interpolation) is correct here.
  let dir = textureLoad(flowTex, vec2<i32>(i32(gid.x), globalY), 0).rg;

  let center = i32(params.halfSamples);
  var sum = sampleBilinear(inputTex, px0, py0, w, h) * weights[center];
  var weightSum = weights[center];

  var i: i32 = 1;
  loop {
    if (i > i32(params.halfSamples)) { break; }
    let fx = px0 + dir.x * params.stepSize * f32(i);
    let fy = py0 + dir.y * params.stepSize * f32(i);
    if (fx < -0.5 || fx > f32(w) - 0.5 || fy < -0.5 || fy > f32(h) - 0.5) { break; }
    let wgt = weights[center + i];
    sum = sum + sampleBilinear(inputTex, fx, fy, w, h) * wgt;
    weightSum = weightSum + wgt;
    i = i + 1;
  }

  i = 1;
  loop {
    if (i > i32(params.halfSamples)) { break; }
    let fx = px0 - dir.x * params.stepSize * f32(i);
    let fy = py0 - dir.y * params.stepSize * f32(i);
    if (fx < -0.5 || fx > f32(w) - 0.5 || fy < -0.5 || fy > f32(h) - 0.5) { break; }
    let wgt = weights[center - i];
    sum = sum + sampleBilinear(inputTex, fx, fy, w, h) * wgt;
    weightSum = weightSum + wgt;
    i = i + 1;
  }

  let result = select(0.0, sum / weightSum, weightSum > 0.0);
  output[u32(localY) * params.width + gid.x] = result;
}
`;
export class WebGPUGradientAlignedBlur {
    backend = 'webgpu';
    config;
    device;
    pipeline;
    flowField;
    // --- class-level device cache ---------------------
    static cachedDevice = null;
    static deviceInitPromise = null;
    static lastUnsupportedReason;
    static errorListenerAttached = false;
    flowTexture = null;
    flowFieldWidth = 0;
    flowFieldHeight = 0;
    flowDirty = true;
    flowBakePromise = null;
    // Bytes we're willing to put in a single GPU buffer for one tile, well
    // under whatever the device actually supports.
    // Large images are processed in row-band tiles bounded by this so memory
    // use stays flat regardless of image size — this is what prevents the
    // crash on big images/concurrent calls.
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
        // maxBufferSize / maxStorageBufferBindingSize are usually the binding
        // constraint that bites first on large images (commonly 256MB / 128MB
        // by default, even when the adapter can do far more). Cap tile size to
        // half of whichever is smaller as a safety margin — driver-reported
        // limits are the ceiling, not a size it's safe to actually hit.
        const limits = this.device.limits;
        this.maxTileBytes = Math.max(WORKGROUP_SIZE * 4, // never go below one row's worth of data
        Math.floor(Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize) *
            WebGPUGradientAlignedBlur.TILE_MEMORY_SAFETY_FACTOR));
        // Surface GPU-side failures (e.g. a validation error from a size that
        // slipped past our checks) as visible console errors instead of a
        // silent hang or an opaque tab crash. Attached once per (shared) device,
        // not once per instance.
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
            // accepting the (often much lower) spec-minimum defaults — e.g. the
            // default maxBufferSize/maxStorageBufferBindingSize are commonly
            // 256MB/128MB, but many adapters support several times that.
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
        const module = this.device.createShaderModule({ code: SHADER_SRC });
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
        // Build+upload in row-chunks rather than one Float32Array(width*height*2)
        // for the whole image — for a large image that single array can itself
        // be gigabytes of JS heap before any GPU work happens.
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
        // Swap in the new texture only after it's fully written, and only
        // destroy the old one after the swap so a concurrent blur() call that
        // already grabbed a reference to `oldTexture` for an in-flight dispatch
        // isn't left pointing at a destroyed resource. (There's still a narrow
        // window if a call reads `this.flowTexture` between the old texture's
        // last use and here — acceptable for a texture that only changes when
        // setFlowField() is called, which is rare relative to blur() calls
        // with a stable flow field.)
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
     * same image) instead of scaling linearly with width*height — see the
     * note above `maxTileBytes` for why. The input/flow textures are still
     * one full-image texture each; if width or height exceeds the device's
     * maxTextureDimension2D, `getFlowTexture`/this method throw a clear
     * error rather than silently corrupting or crashing (see
     * `assertWithinTextureLimits`).
     */
    async blur(input, sigma) {
        if (WebGPUGradientAlignedBlur.cachedDevice !== this.device) {
            // The device this instance was built on has since been lost/replaced
            // (see the `device.lost` handler in acquireDevice()). Fail fast
            // rather than issuing GPU calls against a dead device.
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
        // tile size — the input/flow textures below are still whole-image.
        const bytesPerRow = width * 4;
        const rowsPerTile = Math.max(1, Math.min(height, Math.floor(this.maxTileBytes / bytesPerRow)));
        // Per-call GPU resources — never shared across concurrent blur() calls.
        // Input/flow textures are whole-image (bounded by maxTextureDimension2D,
        // checked above); output/readback buffers are sized to one tile only
        // and reused sequentially across tiles, so peak memory here is
        // O(tileRows * width) rather than O(height * width).
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
            // Tiles are processed sequentially (dispatch -> readback -> next)
            // rather than pipelined, since outputBuffer/readBuffer are reused
            // across iterations — that reuse is exactly what keeps memory
            // bounded, at the cost of some overlap opportunity between tiles.
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