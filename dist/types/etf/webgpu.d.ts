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
 */
import { type ChannelImage, type FlowField, type Vec2, type ETFConfig } from '../types.js';
/**
 * WebGPU-accelerated ETF implementation
 */
export declare class EdgeTangentFlowWebGPU implements FlowField {
    private tangents;
    readonly width: number;
    readonly height: number;
    private static resources;
    private static resourcesPromise;
    private constructor();
    getTangent(x: number, y: number): Vec2;
    getTangentArray(): Float32Array;
    /**
     * Cheap synchronous check — mirrors the shape of isWebGLComputeSupported().
     * This only confirms the API surface exists; it can't confirm an adapter
     * is actually obtainable (that requires the async requestAdapter() call
     * made lazily inside initResources/compute).
     */
    static isSupported(): boolean;
    /**
     * Optional richer diagnostic, matching the BlurStrategyClass shape used
     * elsewhere in this codebase (see types.ts).
     */
    static getUnsupportedReason(): Promise<string | undefined>;
    /**
     * Initialize WebGPU device + pipelines (lazy, cached, size-independent).
     */
    private static initResources;
    /**
     * Compute ETF using WebGPU compute shaders.
     *
     * Note this is async (unlike the WebGL version's synchronous compute()),
     * since device acquisition and the final buffer readback (mapAsync) are
     * both inherently asynchronous in WebGPU.
     */
    static compute(input: ChannelImage, config?: Partial<ETFConfig>, sigmaC?: number): Promise<EdgeTangentFlowWebGPU>;
    /**
     * Visualize the flow field as a grayscale image
     */
    visualize(): ChannelImage;
    /**
     * Cleanup WebGPU resources (call when done with all ETF computations)
     */
    static dispose(): void;
}
/**
 * Local equivalent of isWebGLComputeSupported() from utils/index.js.
 * Consider hoisting this into utils/index.js as a sibling export.
 */
export declare function isWebGPUComputeSupported(): boolean;
//# sourceMappingURL=webgpu.d.ts.map