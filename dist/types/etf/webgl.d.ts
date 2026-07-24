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
 */
import type { ChannelImage, FlowField, ETFConfig, ETFComputer } from '../interfaces/base.js';
import { BaseWebGLStrategy } from '../base.js';
/**
 * WebGL-backed ETFComputer. Holds a lazily-initialized GPU context and
 * shader programs; call dispose() when done to release them.
 */
export declare class WebGLEdgeTangentFlowComputer extends BaseWebGLStrategy implements ETFComputer {
    private resources;
    /**
     * Check if WebGL2 with the required float texture extensions is
     * supported in the current environment. Async to match the
     * `ETFComputerCtor` shape shared with the WebGPU backend, even though
     * this particular check is cheap and synchronous under the hood.
     */
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): string | undefined;
    compute(input: ChannelImage, config?: Partial<ETFConfig>, sigmaC?: number): Promise<FlowField>;
    computeDetailed(input: ChannelImage, config?: Partial<ETFConfig>, sigmaC?: number): Promise<FlowField>;
    computeMultiChannel(inputs: ChannelImage[], config?: Partial<ETFConfig>, sigmaC?: number): Promise<FlowField>;
    computeMultiChannelDetailed(inputs: ChannelImage[], config?: Partial<ETFConfig>, sigmaC?: number): Promise<FlowField>;
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