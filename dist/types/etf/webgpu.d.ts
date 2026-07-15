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
 */
import { type ChannelImage, type FlowField, type ETFConfig, type ETFComputer } from '../interfaces/base.js';
import { BaseWebGPUStrategy } from '../base.js';
/**
 * WebGPU-accelerated ETFComputer. Device/pipeline resources are cached
 * statically (shared across every instance) since acquiring a GPUDevice
 * is expensive and none of that state depends on image size or channel
 * count; per-call state (buffers) is still allocated fresh in
 * computeInternal().
 */
export declare class WebGpuEdgeTangentFlowComputer extends BaseWebGPUStrategy implements ETFComputer {
    private static resources;
    private static resourcesPromise;
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
     * Runs the gradient + structure-tensor-accumulate passes once per input
     * channel (Di Zenzo summation), then a single finalize/blur/extract/
     * refine pipeline identical to the pre-multichannel implementation.
     *
     * Note this is async (unlike a hypothetical synchronous CPU-style
     * compute()), since device acquisition and the final buffer readback
     * (mapAsync) are both inherently asynchronous in WebGPU.
     */
    private computeInternal;
}
/**
 * Local equivalent of isWebGLComputeSupported() from utils/index.js.
 * Consider hoisting this into utils/index.js as a sibling export.
 */
export declare function isWebGPUComputeSupported(): boolean;
//# sourceMappingURL=webgpu.d.ts.map