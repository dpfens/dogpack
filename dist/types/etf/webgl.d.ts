/**
 * WebGL-accelerated Edge Tangent Flow computation
 *
 * Provides significant speedup over the CPU implementation by running
 * gradient computation, structure tensor building/smoothing, and
 * tangent extraction on the GPU.
 *
 * Multi-channel support follows the same Di Zenzo multichannel structure
 * tensor approach as the CPU backend (per-channel tensors summed, then a
 * single eigendecomposition on the combined tensor) — but the summation
 * itself is done on the GPU via additive blending straight into an
 * accumulator framebuffer, rather than reading tensors back to JS and
 * summing them there. Everything from the Gaussian blur pass onward is
 * identical whether the accumulated tensor came from one channel or many.
 *
 * This module has no knowledge of color spaces. It operates purely on
 * ChannelImage scalar fields uploaded as single-channel textures; RGB/Lab/
 * etc. splitting and conversion is the caller's responsibility (see
 * utils/color.ts) and happens before compute()/computeMultiChannel() is
 * ever called.
 */
import type { ChannelImage, FlowField, ETFConfig, ETFComputer } from '../types.js';
/**
 * WebGL-backed ETFComputer. Holds a lazily-initialized GPU context and
 * shader programs; call dispose() when done to release them.
 */
export declare class WebGLEdgeTangentFlowComputer implements ETFComputer {
    private resources;
    /**
     * Check if WebGL2 with the required float texture extensions is
     * supported in the current environment.
     */
    static isSupported(): boolean;
    static getUnsupportedReason(): string | undefined;
    compute(input: ChannelImage, config?: Partial<ETFConfig>, sigmaC?: number): Promise<FlowField>;
    computeMultiChannel(inputs: ChannelImage[], config?: Partial<ETFConfig>, sigmaC?: number): Promise<FlowField>;
    /**
     * Release WebGL resources held by this computer (programs, VAO/VBO,
     * and implicitly the canvas/context). Safe to call multiple times.
     */
    dispose(): void;
    /**
     * Initialize WebGL resources (lazy initialization)
     */
    private initResources;
}
//# sourceMappingURL=webgl.d.ts.map