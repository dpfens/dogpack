/**
 * WebGPU-accelerated Edge Tangent Flow computation
 *
 * Functional port of the WebGL2 implementation (webgl.ts) onto WebGPU
 * compute shaders. Structurally this is much simpler than the WebGL version:
 * there's no canvas, no framebuffers, and no fragment-shader ping-pong —
 * every stage is a compute pass over flat storage buffers, addressed by
 * (y * width + x) instead of texture coordinates. Edge-clamping is done
 * manually via clampIdx() rather than relying on CLAMP_TO_EDGE sampler state.
 *
 * NOTE: like the WebGL version's fixed `u_kernel[33]` uniform array (which
 * capped the Gaussian blur radius at 16), the WebGL implementation had to
 * work around GLSL's lack of dynamically-sized arrays. Storage buffers have
 * no such limit here, so the blur radius is only bounded by sanity/perf
 * limits, not by shader syntax — see MAX_BLUR_RADIUS below.
 *
 * Multi-channel support follows Di Zenzo's approach ("A note on the
 * gradient of a multi-image", CVGIP 33, 1986), matching the CPU backend:
 * per-channel structure tensors are summed (not the resulting tangents),
 * and a single eigendecomposition is performed on the combined tensor.
 * On the GPU this means: for each input channel, run the gradient +
 * structure-tensor passes and *accumulate* (read-modify-write add) into
 * one shared tensor buffer, rather than overwriting it — see
 * STRUCTURE_TENSOR_ACCUMULATE_SHADER. Everything from the Gaussian blur
 * pass onward is unchanged regardless of channel count, so compute() is
 * implemented as computeMultiChannel() called with a single-element array.
 *
 * This module has no knowledge of color spaces — it only ever sees
 * ChannelImage scalar fields. RGB/Lab/etc. splitting and conversion is
 * the caller's responsibility (see utils/color.ts).
 *
 * ---- Row-band tiling (memory) ----
 * Every WGSL shader here addresses purely through the `Params` uniform
 * (width/height/radius/kernelSize) and clampIdx() — none of them assume
 * anything about a "global" image size beyond what's passed in. That
 * means a smaller sub-image ("band") of rows is, as far as every shader
 * is concerned, just an image — no shader changes were needed to support
 * tiling.
 *
 * computeInternal() splits the image into horizontal row bands and runs
 * the full pipeline (gradient -> tensor accumulate -> finalize -> blur ->
 * extract -> refine) once per band, on band-sized buffers, instead of
 * allocating whole-image buffers. Peak GPU memory is therefore bounded by
 * a fixed, tunable budget (bandMemoryBudgetBytes) rather than by image
 * resolution — see planBandLayout() for the memory math and the
 * `halo` comment in computeInternal() for why each band has to compute
 * more rows than it ultimately outputs.
 *
 * ---- Pipelining (throughput) ----
 * Tiling alone would still leave the GPU idle during every band's
 * CPU-side readback if bands were processed strictly one-at-a-time.
 * Instead, two full sets of band buffers ("slots") are allocated once and
 * reused round-robin across bands: band N's compute is submitted without
 * waiting for band N-1's result to be read back, so the GPU queue stays
 * fed while the CPU drains the previous band's output. See the slot
 * synchronization comment inside computeInternal() for the exact
 * correctness argument (it relies on WebGPU's same-queue in-order
 * execution guarantee, plus explicitly awaiting the relevant readback
 * before a slot's buffers — in particular its mapped staging buffer — are
 * reused).
 */
import { DEFAULT_ETF_CONFIG, } from '../interfaces/base.js';
import { TangentFlowField } from './flow-field.js';
import { BaseWebGPUStrategy } from '../base.js';
import COMMON_WGSL_SOURCE from './shaders/webgpu/common.wgsl.js';
import RAW_GRADIENT_SOURCE from './shaders/webgpu/gradient.wgsl.js';
import RAW_STRUCTURE_TENSOR_ACCUMULATE_SOURCE from './shaders/webgpu/structure_tensor_accumulate.wgsl.js';
import RAW_FINALIZE_MAGNITUDE_SOURCE from './shaders/webgpu/finalize_magnitude.wgsl.js';
import RAW_GAUSSIAN_BLUR_SOURCE from './shaders/webgpu/gaussian_blur.wgsl.js';
import RAW_GAUSSIAN_BLUR_TILED_SOURCE from './shaders/webgpu/gaussian_blur_tiled.wgsl.js';
import RAW_TANGENT_EXTRACT_SOURCE from './shaders/webgpu/tangent_extract.wgsl.js';
import RAW_TANGENT_REFINE_SOURCE from './shaders/webgpu/tangent_refine.wgsl.js';
// NOTE: isWebGPUComputeSupported() isn't assumed to exist in utils/index.js
// yet (only isWebGLComputeSupported is referenced in webgl.ts), so a local
// equivalent is defined at the bottom of this file. Feel free to hoist it
// into utils/index.js as a sibling of isWebGLComputeSupported.
/** Sanity cap on Gaussian blur radius (pixels). Not a shader limitation —
 *  just guards against pathological sigma values blowing up dispatch cost. */
const MAX_BLUR_RADIUS = 64;
const WORKGROUP_SIZE = 8;
/**
 * Blur radii up to this value use the shared-memory-tiled blurH/blurV
 * pipelines; anything above it falls back to the original untiled
 * pipelines. This exists purely because `var<workgroup>` arrays must be
 * fixed-size at shader-compile time, so the tile has to be sized for a
 * worst-case radius rather than the actual (data-dependent) one.
 *
 * 32 was chosen to keep per-workgroup storage comfortably under the
 * WebGPU-guaranteed minimum of 16384 bytes (`maxComputeWorkgroupStorageSize`)
 * even though real hardware often allows more:
 *   tile:   (WORKGROUP_SIZE + 2*32) * WORKGROUP_SIZE * 16B (vec4<f32>) = 9216B
 *   kernel: (2*32 + 1) * 4B                                            =  260B
 *   total                                                              = 9476B
 * That leaves ~7KB of headroom for driver overhead/alignment. Radii above
 * this (i.e. large-sigma blurs) are rare in practice and still correct —
 * they just don't get the shared-memory win.
 *
 * Unrelated to row-band tiling below (that's about bounding *image*
 * memory; this is about bounding *workgroup-shared* memory for the blur).
 */
const TILE_RADIUS_CAP = 32;
/**
 * Target peak GPU memory for *one* band-buffer slot (see BandBufferSet
 * and computeInternal()). There are two slots live at once for
 * double-buffering, so actual peak usage is roughly 2x this, plus a
 * small constant for pipelines/kernel/params.
 *
 * This is deliberately conservative (comfortably runs even on a weak
 * integrated GPU) rather than tuned per-adapter, since WebGPU has no API
 * to query *available* (as opposed to theoretical maximum) device memory.
 * Override via WebGpuEdgeTangentFlowComputer.bandMemoryBudgetBytes if you
 * know your target hardware can do better (bigger bands = fewer bands =
 * less halo overhead = faster), or worse (smaller bands = safer).
 */
const DEFAULT_BAND_MEMORY_BUDGET_BYTES = 256 * 1024 * 1024; // 256 MiB
/**
 * Floor on band core-row count. Guards against degenerate configurations
 * (huge halo relative to the memory budget) producing a zero/negative
 * band size, at the cost of possibly exceeding bandMemoryBudgetBytes in
 * that edge case — see planBandLayout().
 */
const MIN_BAND_ROWS = 64;
// ============== WGSL Shader Sources ==============
const GRADIENT_SHADER = COMMON_WGSL_SOURCE + RAW_GRADIENT_SOURCE;
// Computes one channel's structure tensor and *accumulates* it into
// accumBuf (Di Zenzo multichannel summation) instead of overwriting it.
// accumBuf must be zero before the first channel's pass each band — see
// the encoder.clearBuffer() call in computeInternal(), which replaces the
// "freshly-created buffers are zero" guarantee the single-shot version
// used to rely on (band buffers are now allocated once and reused).
//
// .w (magnitude) is deliberately left untouched here. Summing each
// channel's individual sqrt(e+g) would be wrong, since sqrt is nonlinear:
// sum(sqrt(e_k + g_k)) != sqrt(sum(e_k) + sum(g_k)). Only the latter is
// the Di Zenzo-consistent combined gradient magnitude, so it's computed
// once from the final accumulated trace in FINALIZE_MAGNITUDE_SHADER
// instead.
const STRUCTURE_TENSOR_ACCUMULATE_SHADER = COMMON_WGSL_SOURCE + RAW_STRUCTURE_TENSOR_ACCUMULATE_SOURCE;
// Runs once per band, after every channel's structure tensor has been
// accumulated. Re-derives magnitude from the combined tensor's trace:
// sqrt(E + G). For a single channel this equals sqrt(gx^2 + gy^2) ==
// hypot(gx, gy), so compute() (a single-channel computeMultiChannel()
// call) sees identical behavior to before this pass existed.
const FINALIZE_MAGNITUDE_SHADER = COMMON_WGSL_SOURCE + RAW_FINALIZE_MAGNITUDE_SOURCE;
// Both blur directions live in the same module — WGSL allows multiple
// @compute entry points per shader module, so this replaces the WebGL
// version's two separate H/V programs with one module and two pipelines.
const GAUSSIAN_BLUR_SHADER = COMMON_WGSL_SOURCE + RAW_GAUSSIAN_BLUR_SOURCE;
// Tiled counterpart to GAUSSIAN_BLUR_SHADER, used when radius <=
// TILE_RADIUS_CAP (see that constant's comment for the sizing rationale).
// Each workgroup loads its input footprint into workgroup-shared memory
// once, then every thread reads its taps from shared memory instead of
// re-issuing up to `kernelSize` independent global storage-buffer reads —
// the redundant-read pattern the untiled version has, since neighboring
// threads' kernel windows overlap almost entirely.
const GAUSSIAN_BLUR_TILED_SHADER = COMMON_WGSL_SOURCE + RAW_GAUSSIAN_BLUR_TILED_SOURCE;
const TANGENT_EXTRACT_SHADER = COMMON_WGSL_SOURCE + RAW_TANGENT_EXTRACT_SOURCE;
// Unlike the blur radius, the refine neighborhood is a fixed 5x5 (radius
// 2) — so the tile size is a compile-time constant with no data-dependent
// cap/fallback needed, unlike GAUSSIAN_BLUR_TILED_SHADER above. Every
// invocation in the untiled version re-read the same 5x5=25 neighbors its
// neighbors were also reading independently from global storage; here
// each workgroup loads its (WORKGROUP_SIZE+4)^2 footprint once instead.
const TANGENT_REFINE_SHADER = COMMON_WGSL_SOURCE + RAW_TANGENT_REFINE_SOURCE;
/**
 * WebGPU-accelerated ETFComputer. Device/pipeline resources are cached
 * statically (shared across every instance) since acquiring a GPUDevice
 * is expensive and none of that state depends on image size or channel
 * count; per-call state (band buffers) is still allocated fresh in
 * computeInternal().
 */
export class WebGpuEdgeTangentFlowComputer extends BaseWebGPUStrategy {
    static resources = null;
    static resourcesPromise = null;
    /**
     * Target peak GPU memory for one band-buffer slot. See the constant's
     * doc comment above for context; exposed as a static so callers who
     * know their target hardware can tune it without forking this file.
     * Changing it takes effect on the next compute()/computeMultiChannel()
     * call (band layout is computed fresh per call).
     */
    static bandMemoryBudgetBytes = DEFAULT_BAND_MEMORY_BUDGET_BYTES;
    /**
     * Cheap check — mirrors the shape of isWebGLComputeSupported(), just
     * wrapped in a resolved Promise to match the async `ETFComputerCtor`
     * shape. This only confirms the API surface exists; it can't confirm
     * an adapter is actually obtainable (that requires the async
     * requestAdapter() call made lazily inside
     * initResources()/computeInternal()) — use getUnsupportedReason() for
     * that deeper check.
     */
    static async isSupported() {
        return isWebGPUComputeSupported();
    }
    /**
     * Optional richer diagnostic, matching the ETFComputerCtor shape in
     * types.ts. Async, since it actually attempts to obtain an adapter.
     */
    static async getUnsupportedReason() {
        if (typeof navigator === 'undefined' || !navigator.gpu) {
            return 'navigator.gpu is unavailable in this environment';
        }
        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                return 'No WebGPU adapter could be obtained';
            }
            return undefined;
        }
        catch (err) {
            return `WebGPU adapter request failed: ${err.message}`;
        }
    }
    /**
     * Initialize WebGPU device + pipelines (lazy, cached, size-independent).
     */
    static async initResources() {
        if (this.resources) {
            return this.resources;
        }
        if (this.resourcesPromise) {
            return this.resourcesPromise;
        }
        this.resourcesPromise = (async () => {
            if (!navigator.gpu) {
                throw new Error('WebGPU not supported in this environment');
            }
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                throw new Error('Failed to obtain a WebGPU adapter');
            }
            const hasTimestampQuery = adapter.features.has('timestamp-query');
            // Without explicit requiredLimits, WebGPU hands back the *default*
            // limits (maxBufferSize/maxStorageBufferBindingSize commonly 256MB/
            // 128MB) rather than what the adapter can actually do. Band buffers
            // are sized well under that regardless (see
            // DEFAULT_BAND_MEMORY_BUDGET_BYTES), but requesting the real
            // adapter limits still raises the ceiling for callers who bump
            // bandMemoryBudgetBytes up on capable hardware.
            const device = await adapter.requestDevice({
                requiredFeatures: hasTimestampQuery ? ['timestamp-query'] : [],
                requiredLimits: {
                    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
                    maxBufferSize: adapter.limits.maxBufferSize,
                },
            });
            device.lost.then((info) => {
                // Invalidate the cache so the next call re-initializes.
                if (this.resources && this.resources.device === device) {
                    this.resources = null;
                    this.resourcesPromise = null;
                }
                console.warn(`WebGPU device lost: ${info.message}`);
            });
            // Every shader module below declares `override WORKGROUP_SIZE: u32`
            // (via #include "./_workgroup.wgsl") instead of having it baked in
            // as a JS-side template value, so it has to be supplied here at
            // pipeline-creation time. TILE_WIDTH/KERNEL_SHARED_SIZE/
            // REFINE_TILE_DIM are override-expressions *derived* from
            // WORKGROUP_SIZE (and TILE_RADIUS_CAP) inside the WGSL itself, so
            // they don't need their own entries here.
            const makePipeline = (code, entryPoint = 'main', constants = { WORKGROUP_SIZE }) => device.createComputePipeline({
                layout: 'auto',
                compute: {
                    module: device.createShaderModule({ code }),
                    entryPoint,
                    constants,
                },
            });
            const blurModule = device.createShaderModule({ code: GAUSSIAN_BLUR_SHADER });
            const blurHPipeline = device.createComputePipeline({
                layout: 'auto',
                compute: { module: blurModule, entryPoint: 'blurH', constants: { WORKGROUP_SIZE } },
            });
            const blurVPipeline = device.createComputePipeline({
                layout: 'auto',
                compute: { module: blurModule, entryPoint: 'blurV', constants: { WORKGROUP_SIZE } },
            });
            const blurTiledModule = device.createShaderModule({ code: GAUSSIAN_BLUR_TILED_SHADER });
            const blurHTiledPipeline = device.createComputePipeline({
                layout: 'auto',
                compute: {
                    module: blurTiledModule,
                    entryPoint: 'blurHTiled',
                    constants: { WORKGROUP_SIZE, TILE_RADIUS_CAP },
                },
            });
            const blurVTiledPipeline = device.createComputePipeline({
                layout: 'auto',
                compute: {
                    module: blurTiledModule,
                    entryPoint: 'blurVTiled',
                    constants: { WORKGROUP_SIZE, TILE_RADIUS_CAP },
                },
            });
            const resources = {
                device,
                gradientPipeline: makePipeline(GRADIENT_SHADER),
                structureTensorAccumulatePipeline: makePipeline(STRUCTURE_TENSOR_ACCUMULATE_SHADER),
                finalizeMagnitudePipeline: makePipeline(FINALIZE_MAGNITUDE_SHADER),
                blurHPipeline,
                blurVPipeline,
                blurHTiledPipeline,
                blurVTiledPipeline,
                tangentExtractPipeline: makePipeline(TANGENT_EXTRACT_SHADER),
                tangentRefinePipeline: makePipeline(TANGENT_REFINE_SHADER),
                hasTimestampQuery,
            };
            this.resources = resources;
            return resources;
        })();
        return this.resourcesPromise;
    }
    /**
     * Compute ETF from a single scalar channel using WebGPU compute shaders.
     * Implemented as computeMultiChannel() with a single-element array — the
     * per-channel accumulate pass degenerates to a plain assignment when
     * there's only one channel (see STRUCTURE_TENSOR_ACCUMULATE_SHADER).
     */
    async compute(input, config = {}, sigmaC) {
        return this.computeInternal([input], config, sigmaC);
    }
    /**
     * Compute ETF jointly from several co-registered scalar channels (e.g.
     * R/G/B or L/a/b), using Di Zenzo's multichannel structure tensor. All
     * channels must share the same width/height.
     */
    async computeMultiChannel(inputs, config = {}, sigmaC) {
        if (inputs.length === 0) {
            throw new Error('computeMultiChannel requires at least one channel');
        }
        const { width, height } = inputs[0];
        for (const channel of inputs) {
            if (channel.width !== width || channel.height !== height) {
                throw new Error('All channels passed to computeMultiChannel must share the same dimensions');
            }
        }
        return this.computeInternal(inputs, config, sigmaC);
    }
    /**
     * Release the cached WebGPU device + pipelines. Safe to call even if no
     * compute()/computeMultiChannel() call has happened yet. Since the
     * underlying resources are cached statically (shared across instances —
     * see the class doc comment), this releases them for every
     * WebGpuEdgeTangentFlowComputer instance, not just this one; call it
     * once you're done with all ETF computations for the session.
     */
    dispose() {
        const ctor = WebGpuEdgeTangentFlowComputer;
        if (ctor.resources) {
            ctor.resources.device.destroy();
            ctor.resources = null;
            ctor.resourcesPromise = null;
        }
    }
    /**
     * Shared implementation behind compute() and computeMultiChannel().
     *
     * Splits the image into horizontal row bands and runs the full
     * gradient -> tensor-accumulate -> finalize -> blur -> extract ->
     * refine pipeline once per band, on two round-robin, reused,
     * band-sized buffer sets ("slots") — see the module-level doc comment
     * for why this bounds memory and how the double-buffering keeps the
     * GPU fed. Buffer allocation, band-size planning, and the halo math
     * are the only real additions versus a single-shot whole-image run;
     * every WGSL pipeline and bind-group-layout is identical to the
     * non-tiled version, since every shader already only knows about
     * whatever width/height it's told via Params.
     */
    async computeInternal(inputs, config, sigmaC) {
        const cfg = { ...DEFAULT_ETF_CONFIG, ...config };
        const { width, height } = inputs[0];
        const channelCount = inputs.length;
        const res = await WebGpuEdgeTangentFlowComputer.initResources();
        const { device } = res;
        const smoothSigma = sigmaC ?? cfg.kernelSize / 2.45;
        const radius = Math.min(MAX_BLUR_RADIUS, Math.max(1, Math.ceil(smoothSigma * 2.45)));
        const kernelSize = radius * 2 + 1;
        const kernel = generateGaussianKernel(smoothSigma, kernelSize);
        // `halo` is how many extra rows above/below a band's *target* output
        // rows have to be computed (and hence loaded) for those target rows
        // to come out identical to a full, untiled run:
        //   ±1        Sobel gradient stencil (gradient.wgsl)
        //   ±radius   separable Gaussian blur (blurH then blurV — a single
        //             `radius` margin covers both passes: blurH is computed
        //             row-independently so needs no extra y-margin itself,
        //             and blurV only needs blurH's output `radius` rows out,
        //             which that single margin already provides)
        //   ±2*iters  5x5 tangent-refine kernel, applied `iterations` times —
        //             each pass "eats" 2 rows of validity from the band's
        //             edges, so the untouched margin has to start
        //             2*iterations rows out from the target rows
        // These layers are consumed outside-in as you move inward from the
        // band edge (refine's margin is "wrong" first, protecting the blur
        // margin inside it, which protects the 1-row gradient margin inside
        // that), which is why the contributions add rather than multiply.
        const halo = radius + 1 + 2 * cfg.iterations;
        const { bandRows, numBands } = planBandLayout(width, height, channelCount, halo, device.limits, WebGpuEdgeTangentFlowComputer.bandMemoryBudgetBytes);
        const maxBandBufHeight = Math.min(bandRows, height) + 2 * halo;
        const kernelBuf = createBufferWithData(device, kernel, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        const dispatchX = Math.ceil(width / WORKGROUP_SIZE);
        return this.runGuarded(device, async () => {
            // Two full sets of band-sized buffers, alternated per band, so band
            // N's compute can be submitted before band N-1's result has
            // finished being read back — see synchronization note below.
            const slots = [
                createBandBufferSet(device, width, maxBandBufHeight, channelCount),
                createBandBufferSet(device, width, maxBandBufHeight, channelCount),
            ];
            // Reusable JS-side scratch for building each band's halo-padded,
            // edge-clamped channel rows — one buffer per (slot, channel), sized
            // once up front instead of allocated fresh every band.
            const channelScratch = [0, 1].map(() => inputs.map(() => new Float32Array(width * maxBandBufHeight)));
            const tangents = new Float32Array(width * height * 2);
            // Slot's in-flight "read this band's staging buffer back to the
            // CPU" promise, if any. Indexed by slot (0 or 1), not by band.
            const pendingReadback = [null, null];
            try {
                for (let bandIdx = 0; bandIdx < numBands; bandIdx++) {
                    const slot = bandIdx % 2;
                    const bufs = slots[slot];
                    const bandStartY = bandIdx * bandRows;
                    const bandRowsThisBand = Math.min(bandRows, height - bandStartY);
                    const bandBufHeight = bandRowsThisBand + 2 * halo;
                    const bandPixelCount = width * bandBufHeight;
                    // This slot's buffers were last used two bands ago (or never,
                    // for bandIdx < 2). Before touching them again — uploading new
                    // channel data, clearing tensorAccumBuf, or recording new
                    // commands that target them — make sure that band's GPU work
                    // is done and, critically, that its staging buffer has been
                    // unmap()'d: WebGPU rejects any submission that references a
                    // still-mapped buffer, and mapAsync()/unmap() are the one part
                    // of this loop that ISN'T covered by the queue's automatic
                    // same-queue-in-order execution guarantee.
                    if (pendingReadback[slot]) {
                        await pendingReadback[slot];
                        pendingReadback[slot] = null;
                    }
                    // ---- Build + upload this band's halo-padded channel rows ----
                    for (let k = 0; k < channelCount; k++) {
                        const scratch = channelScratch[slot][k];
                        buildChannelBandData(inputs[k].data, width, height, bandStartY, bandRowsThisBand, halo, scratch);
                        device.queue.writeBuffer(bufs.channelInputBufs[k], 0, scratch.buffer, 0, bandPixelCount * 4);
                    }
                    // Params for every pointwise/gradient/extract/refine pass this
                    // band (radius/kernelSize unused by those shaders); a separate
                    // one for the two blur passes, which do need radius/kernelSize.
                    // `height` here is the *band's* local height, not the image's.
                    const params = createParamsBuffer(device, { width, height: bandBufHeight, radius: 0, kernelSize: 0 });
                    const blurParams = createParamsBuffer(device, { width, height: bandBufHeight, radius, kernelSize });
                    const dispatchY = Math.ceil(bandBufHeight / WORKGROUP_SIZE);
                    const encoder = device.createCommandEncoder();
                    // tensorAccumBuf is reused across bands (unlike the one-shot
                    // version, which relied on freshly-created WebGPU buffers being
                    // guaranteed zero), so it has to be explicitly re-zeroed before
                    // each band's per-channel accumulation loop.
                    encoder.clearBuffer(bufs.tensorAccumBuf);
                    // Steps 1-2: per channel, gradient then accumulate into tensorAccumBuf.
                    for (let k = 0; k < channelCount; k++) {
                        {
                            const bindGroup = device.createBindGroup({
                                layout: res.gradientPipeline.getBindGroupLayout(0),
                                entries: [
                                    { binding: 0, resource: { buffer: params } },
                                    { binding: 1, resource: { buffer: bufs.channelInputBufs[k] } },
                                    { binding: 2, resource: { buffer: bufs.gradientScratchBuf } },
                                ],
                            });
                            const pass = encoder.beginComputePass();
                            pass.setPipeline(res.gradientPipeline);
                            pass.setBindGroup(0, bindGroup);
                            pass.dispatchWorkgroups(dispatchX, dispatchY);
                            pass.end();
                        }
                        {
                            const bindGroup = device.createBindGroup({
                                layout: res.structureTensorAccumulatePipeline.getBindGroupLayout(0),
                                entries: [
                                    { binding: 0, resource: { buffer: params } },
                                    { binding: 1, resource: { buffer: bufs.gradientScratchBuf } },
                                    { binding: 2, resource: { buffer: bufs.tensorAccumBuf } },
                                ],
                            });
                            const pass = encoder.beginComputePass();
                            pass.setPipeline(res.structureTensorAccumulatePipeline);
                            pass.setBindGroup(0, bindGroup);
                            pass.dispatchWorkgroups(dispatchX, dispatchY);
                            pass.end();
                        }
                    }
                    // Step 3: finalize magnitude from the combined trace.
                    {
                        const bindGroup = device.createBindGroup({
                            layout: res.finalizeMagnitudePipeline.getBindGroupLayout(0),
                            entries: [
                                { binding: 0, resource: { buffer: params } },
                                { binding: 1, resource: { buffer: bufs.tensorAccumBuf } },
                            ],
                        });
                        const pass = encoder.beginComputePass();
                        pass.setPipeline(res.finalizeMagnitudePipeline);
                        pass.setBindGroup(0, bindGroup);
                        pass.dispatchWorkgroups(dispatchX, dispatchY);
                        pass.end();
                    }
                    // Step 4: Gaussian blur the structure tensor (horizontal then vertical).
                    {
                        const useTiledBlur = radius <= TILE_RADIUS_CAP;
                        const blurHPipe = useTiledBlur ? res.blurHTiledPipeline : res.blurHPipeline;
                        const blurVPipe = useTiledBlur ? res.blurVTiledPipeline : res.blurVPipeline;
                        const bindGroupH = device.createBindGroup({
                            layout: blurHPipe.getBindGroupLayout(0),
                            entries: [
                                { binding: 0, resource: { buffer: blurParams } },
                                { binding: 1, resource: { buffer: bufs.tensorAccumBuf } },
                                { binding: 2, resource: { buffer: bufs.blurTempBuf } },
                                { binding: 3, resource: { buffer: kernelBuf } },
                            ],
                        });
                        const passH = encoder.beginComputePass();
                        passH.setPipeline(blurHPipe);
                        passH.setBindGroup(0, bindGroupH);
                        passH.dispatchWorkgroups(dispatchX, dispatchY);
                        passH.end();
                        const bindGroupV = device.createBindGroup({
                            layout: blurVPipe.getBindGroupLayout(0),
                            entries: [
                                { binding: 0, resource: { buffer: blurParams } },
                                { binding: 1, resource: { buffer: bufs.blurTempBuf } },
                                { binding: 2, resource: { buffer: bufs.blurOutputBuf } },
                                { binding: 3, resource: { buffer: kernelBuf } },
                            ],
                        });
                        const passV = encoder.beginComputePass();
                        passV.setPipeline(blurVPipe);
                        passV.setBindGroup(0, bindGroupV);
                        passV.dispatchWorkgroups(dispatchX, dispatchY);
                        passV.end();
                    }
                    // Step 5: extract initial tangent field.
                    {
                        const bindGroup = device.createBindGroup({
                            layout: res.tangentExtractPipeline.getBindGroupLayout(0),
                            entries: [
                                { binding: 0, resource: { buffer: params } },
                                { binding: 1, resource: { buffer: bufs.blurOutputBuf } },
                                { binding: 2, resource: { buffer: bufs.tangentBuf1 } },
                            ],
                        });
                        const pass = encoder.beginComputePass();
                        pass.setPipeline(res.tangentExtractPipeline);
                        pass.setBindGroup(0, bindGroup);
                        pass.dispatchWorkgroups(dispatchX, dispatchY);
                        pass.end();
                    }
                    // Step 6: refine tangent field iteratively (ping-pong between buffers).
                    let readBuf = bufs.tangentBuf1;
                    let writeBuf = bufs.tangentBuf2;
                    for (let i = 0; i < cfg.iterations; i++) {
                        const bindGroup = device.createBindGroup({
                            layout: res.tangentRefinePipeline.getBindGroupLayout(0),
                            entries: [
                                { binding: 0, resource: { buffer: params } },
                                { binding: 1, resource: { buffer: readBuf } },
                                { binding: 2, resource: { buffer: writeBuf } },
                            ],
                        });
                        const pass = encoder.beginComputePass();
                        pass.setPipeline(res.tangentRefinePipeline);
                        pass.setBindGroup(0, bindGroup);
                        pass.dispatchWorkgroups(dispatchX, dispatchY);
                        pass.end();
                        [readBuf, writeBuf] = [writeBuf, readBuf];
                    }
                    // Copy this band's final tangent buffer into its slot's staging
                    // buffer. This is deliberately the LAST command in the
                    // submission: awaiting its mapAsync (below) is then sufficient
                    // proof that every earlier command in this band's submission —
                    // and hence every buffer this slot owns — has finished on the
                    // GPU, without any further explicit synchronization.
                    encoder.copyBufferToBuffer(readBuf, 0, bufs.stagingBuf, 0, bandPixelCount * 4 * 4);
                    device.queue.submit([encoder.finish()]);
                    // Deliberately NOT awaited here — stashed instead. The next
                    // time this slot comes up (two bands from now) we await it
                    // before reusing these buffers. That gap is what lets band
                    // N+1's upload + dispatch overlap with band N's GPU execution
                    // and CPU-side readback instead of stalling on it.
                    const capturedBandStartY = bandStartY;
                    const capturedBandRows = bandRowsThisBand;
                    pendingReadback[slot] = (async () => {
                        await bufs.stagingBuf.mapAsync(GPUMapMode.READ);
                        const mapped = new Float32Array(bufs.stagingBuf.getMappedRange(0, bandPixelCount * 4 * 4).slice(0));
                        bufs.stagingBuf.unmap();
                        writeBandOutputRows(mapped, width, capturedBandStartY, capturedBandRows, halo, tangents);
                    })();
                }
                // Drain whichever 1-2 bands are still in flight after the loop.
                await Promise.all(pendingReadback.filter((p) => p !== null));
            }
            finally {
                // Cleanup runs even if a band's compute/readback threw, so a
                // mid-run failure on a huge image doesn't leak GPU memory.
                for (const bufs of slots)
                    destroyBandBufferSet(bufs);
                kernelBuf.destroy();
            }
            return TangentFlowField.fromFloat32Array(tangents, width, height);
        });
    }
}
// ============== Helper Functions ==============
function alignTo4(bytes) {
    return Math.ceil(bytes / 4) * 4;
}
function createBufferWithData(device, data, usage) {
    const size = alignTo4(data.byteLength);
    const buffer = device.createBuffer({ size, usage, mappedAtCreation: true });
    new Float32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
}
function createEmptyVec4Buffer(device, pixelCount) {
    return device.createBuffer({
        size: pixelCount * 4 * 4, // vec4<f32>
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
}
function createParamsBuffer(device, params) {
    const buffer = device.createBuffer({
        size: 16, // 4 x u32, already 16-byte aligned
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, new Uint32Array([params.width, params.height, params.radius, params.kernelSize]));
    return buffer;
}
function generateGaussianKernel(sigma, size) {
    const kernel = new Float32Array(size);
    const center = Math.floor(size / 2);
    let sum = 0;
    for (let i = 0; i < size; i++) {
        const x = i - center;
        kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
        sum += kernel[i];
    }
    for (let i = 0; i < size; i++) {
        kernel[i] /= sum;
    }
    return kernel;
}
/**
 * Decide how many core (non-halo) rows each band should cover, and how
 * many bands that means for the image, given a per-slot memory budget.
 *
 * Every intermediate that scales with band height is a whole-band
 * vec4<f32> buffer (16 bytes/pixel): tensorAccum, gradientScratch,
 * blurTemp, blurOutput, tangentBuf1, tangentBuf2 (6 of them), plus one
 * scalar f32 input buffer per channel (4 bytes/pixel), plus one vec4
 * staging buffer for readback (16 bytes/pixel). `bandRows` is chosen so
 * that (bandRows + 2*halo) rows of all of those together fit under
 * budgetBytes, floored at MIN_BAND_ROWS so a large halo can't produce a
 * degenerate (zero/negative) band — in that edge case the actual
 * footprint may exceed budgetBytes; see the thrown error below for the
 * case where it can't be made to fit even at the floor.
 */
function planBandLayout(width, height, channelCount, halo, limits, budgetBytes) {
    const bytesPerRow = width * (6 * 16 + channelCount * 4 + 16);
    let bandRows = Math.floor(budgetBytes / bytesPerRow) - 2 * halo;
    bandRows = Math.max(MIN_BAND_ROWS, bandRows);
    bandRows = Math.min(bandRows, height);
    // Hard device ceiling: the padded band buffer still has to fit within
    // a single storage binding. Shrink toward MIN_BAND_ROWS if needed.
    const maxBindableBytes = Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize);
    while (bandRows > MIN_BAND_ROWS && (bandRows + 2 * halo) * width * 16 > maxBindableBytes) {
        bandRows = Math.max(MIN_BAND_ROWS, bandRows - MIN_BAND_ROWS);
    }
    const bandBufHeight = bandRows + 2 * halo;
    if (bandBufHeight * width * 16 > maxBindableBytes) {
        throw new Error(`[EdgeTangentFlowWebGPU] Cannot fit even a ${MIN_BAND_ROWS}-row band ` +
            `(halo=${halo} rows, from blur radius + refine iterations) within ` +
            `this device's maxStorageBufferBindingSize/maxBufferSize ` +
            `(${maxBindableBytes} bytes) at width=${width}. Reduce blur sigma/` +
            `radius or refine iterations, or downscale the image.`);
    }
    const numBands = Math.max(1, Math.ceil(height / bandRows));
    return { bandRows, numBands };
}
/**
 * Allocate one full set of band-sized GPU buffers, sized for
 * maxBandBufHeight rows (the largest band that will occur this call).
 */
function createBandBufferSet(device, width, maxBandBufHeight, channelCount) {
    const pixelCount = width * maxBandBufHeight;
    return {
        channelInputBufs: Array.from({ length: channelCount }, () => device.createBuffer({
            size: alignTo4(pixelCount * 4),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        })),
        gradientScratchBuf: createEmptyVec4Buffer(device, pixelCount),
        tensorAccumBuf: createEmptyVec4Buffer(device, pixelCount),
        blurTempBuf: createEmptyVec4Buffer(device, pixelCount),
        blurOutputBuf: createEmptyVec4Buffer(device, pixelCount),
        tangentBuf1: createEmptyVec4Buffer(device, pixelCount),
        tangentBuf2: createEmptyVec4Buffer(device, pixelCount),
        stagingBuf: device.createBuffer({
            size: pixelCount * 4 * 4,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        }),
    };
}
function destroyBandBufferSet(set) {
    for (const buf of set.channelInputBufs)
        buf.destroy();
    set.gradientScratchBuf.destroy();
    set.tensorAccumBuf.destroy();
    set.blurTempBuf.destroy();
    set.blurOutputBuf.destroy();
    set.tangentBuf1.destroy();
    set.tangentBuf2.destroy();
    set.stagingBuf.destroy();
}
/**
 * Fill `out` (length must be width * (bandRows + 2*halo)) with this
 * channel's rows [bandStartY - halo, bandStartY + bandRows + halo),
 * clamping source row indices to [0, height-1] — i.e. replicating the
 * true image's top/bottom edge rows exactly where clampIdx() would have,
 * had this been computed as part of a single whole-image run. Interior
 * band boundaries (not at the true image edge) get real neighboring row
 * data, not clamped/replicated data.
 */
function buildChannelBandData(src, width, height, bandStartY, bandRows, halo, out) {
    const bandBufHeight = bandRows + 2 * halo;
    for (let localY = 0; localY < bandBufHeight; localY++) {
        const srcY = Math.max(0, Math.min(height - 1, bandStartY - halo + localY));
        out.set(src.subarray(srcY * width, srcY * width + width), localY * width);
    }
}
/**
 * Crop the halo off a band's mapped (stride-4: x, y, magnitude, 1)
 * readback and write the core (stride-2: x, y) rows into the full-image
 * output buffer at the right offset.
 */
function writeBandOutputRows(mapped, width, bandStartY, bandRows, halo, tangentsOut) {
    for (let localY = 0; localY < bandRows; localY++) {
        const srcRowOffset = (halo + localY) * width * 4;
        const dstRowOffset = (bandStartY + localY) * width * 2;
        for (let x = 0; x < width; x++) {
            tangentsOut[dstRowOffset + x * 2] = mapped[srcRowOffset + x * 4];
            tangentsOut[dstRowOffset + x * 2 + 1] = mapped[srcRowOffset + x * 4 + 1];
        }
    }
}
/**
 * Local equivalent of isWebGLComputeSupported() from utils/index.js.
 * Consider hoisting this into utils/index.js as a sibling export.
 */
export function isWebGPUComputeSupported() {
    return typeof navigator !== 'undefined' && !!navigator.gpu;
}
//# sourceMappingURL=webgpu.js.map