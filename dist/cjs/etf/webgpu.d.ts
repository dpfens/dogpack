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
import { type ChannelImage, type FlowField, type ETFConfig, type ETFComputer } from '../interfaces/base.js';
import { BaseWebGPUStrategy } from '../base.js';
/**
 * WebGPU-accelerated ETFComputer. Device/pipeline resources are cached
 * statically (shared across every instance) since acquiring a GPUDevice
 * is expensive and none of that state depends on image size or channel
 * count; per-call state (band buffers) is still allocated fresh in
 * computeInternal().
 */
export declare class WebGpuEdgeTangentFlowComputer extends BaseWebGPUStrategy implements ETFComputer {
    private static resources;
    private static resourcesPromise;
    /**
     * Target peak GPU memory for one band-buffer slot. See the constant's
     * doc comment above for context; exposed as a static so callers who
     * know their target hardware can tune it without forking this file.
     * Changing it takes effect on the next compute()/computeMultiChannel()
     * call (band layout is computed fresh per call).
     */
    static bandMemoryBudgetBytes: number;
    /**
     * Cheap check — mirrors the shape of isWebGLComputeSupported(), just
     * wrapped in a resolved Promise to match the async `ETFComputerCtor`
     * shape. This only confirms the API surface exists; it can't confirm
     * an adapter is actually obtainable (that requires the async
     * requestAdapter() call made lazily inside
     * initResources()/computeInternal()) — use getUnsupportedReason() for
     * that deeper check.
     */
    static isSupported(): Promise<boolean>;
    /**
     * Optional richer diagnostic, matching the ETFComputerCtor shape in
     * types.ts. Async, since it actually attempts to obtain an adapter.
     */
    static getUnsupportedReason(): Promise<string | undefined>;
    /**
     * Initialize WebGPU device + pipelines (lazy, cached, size-independent).
     */
    private static initResources;
    private validateChannels;
    /**
     * Compute ETF from a single scalar channel using WebGPU compute shaders.
     * Implemented as computeMultiChannel() with a single-element array — the
     * per-channel accumulate pass degenerates to a plain assignment when
     * there's only one channel (see STRUCTURE_TENSOR_ACCUMULATE_SHADER).
     */
    compute(input: ChannelImage, config?: Partial<ETFConfig>, sigmaC?: number): Promise<FlowField>;
    /**
     * Compute ETF jointly from several co-registered scalar channels (e.g.
     * R/G/B or L/a/b), using Di Zenzo's multichannel structure tensor. All
     * channels must share the same width/height.
     */
    computeMultiChannel(inputs: ChannelImage[], config?: Partial<ETFConfig>, sigmaC?: number): Promise<FlowField>;
    /**
     * Release the cached WebGPU device + pipelines. Safe to call even if no
     * compute()/computeMultiChannel() call has happened yet. Since the
     * underlying resources are cached statically (shared across instances —
     * see the class doc comment), this releases them for every
     * WebGpuEdgeTangentFlowComputer instance, not just this one; call it
     * once you're done with all ETF computations for the session.
     */
    dispose(): void;
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
    private computeInternal;
}
/**
 * Local equivalent of isWebGLComputeSupported() from utils/index.js.
 * Consider hoisting this into utils/index.js as a sibling export.
 */
export declare function isWebGPUComputeSupported(): boolean;
//# sourceMappingURL=webgpu.d.ts.map