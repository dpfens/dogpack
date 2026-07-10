import type { ETFConfig, FlowField, ChannelImage, Vec2 } from '../types.js';
export type ETFImpl = 'cpu' | 'webgl' | 'webgpu' | 'auto';
/**
 * Unified Edge Tangent Flow that automatically selects the best implementation
 *
 * Preference order in 'auto' mode: WebGPU > WebGL > CPU. WebGPU compute is
 * inherently async (device acquisition + buffer readback both require
 * awaiting), so compute() is now async across the board — the WebGL and
 * CPU paths are still synchronous under the hood, but are wrapped so the
 * public API is consistent regardless of which implementation gets picked.
 */
export declare class EdgeTangentFlow implements FlowField {
    private impl;
    readonly width: number;
    readonly height: number;
    private constructor();
    getTangent(x: number, y: number): Vec2;
    getTangentArray(): Float32Array;
    visualize(): ChannelImage;
    /**
     * Check if WebGPU acceleration is available
     *
     * Note: this is the same cheap synchronous check EdgeTangentFlowWebGPU
     * itself uses (navigator.gpu presence) — it doesn't guarantee an adapter
     * can actually be obtained. Use EdgeTangentFlowWebGPU.getUnsupportedReason()
     * for a more thorough (async) check if needed.
     */
    static isWebGPUSupported(): boolean;
    /**
     * Check if WebGL acceleration is available
     */
    static isWebGLSupported(): boolean;
    /**
     * Compute ETF using the best available implementation
     *
     * @param input Grayscale image
     * @param config ETF configuration
     * @param sigmaC Structure tensor smoothing sigma
     * @param forceImpl Force a specific implementation ('cpu' | 'webgl' | 'webgpu' | 'auto')
     */
    static compute(input: ChannelImage, config?: Partial<ETFConfig>, sigmaC?: number, forceImpl?: ETFImpl): Promise<EdgeTangentFlow>;
    /**
     * Cleanup WebGPU and WebGL resources
     */
    static dispose(): void;
}
export default EdgeTangentFlow;
//# sourceMappingURL=index.d.ts.map