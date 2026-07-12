import type { ETFComputer, ETFConfig, FlowField, ChannelImage } from '../types.js';
export type ETFImpl = 'cpu' | 'webgl' | 'webgpu' | 'auto';
/**
 * Edge Tangent Flow computer that automatically selects the best available
 * backend implementation.
 *
 * Preference order in 'auto' mode: WebGPU > WebGL > CPU. Backend selection
 * is stateful and happens at most once per instance: the first call to
 * compute()/computeMultiChannel() probes backends (honoring `forceImpl`,
 * or falling back WebGPU -> WebGL -> CPU) and caches whichever one
 * actually works; every later call on this instance reuses that same
 * backend directly. This avoids re-attempting WebGPU/WebGL acquisition on
 * every call, and means dispose() has a single, well-defined backend
 * instance to release GPU resources from.
 */
export declare class EdgeTangentFlowComputer implements ETFComputer {
    private readonly forceImpl;
    private computer;
    constructor(forceImpl?: ETFImpl);
    /**
     * Check if WebGPU acceleration is available.
     *
     * Note: this is the same cheap synchronous check WebGpuEdgeTangentFlowComputer
     * itself uses (navigator.gpu presence) — it doesn't guarantee an adapter
     * can actually be obtained. Use WebGpuEdgeTangentFlowComputer.getUnsupportedReason()
     * for a more thorough (async) check if needed.
     */
    static isWebGPUSupported(): boolean;
    /**
     * Check if WebGL acceleration is available.
     */
    static isWebGLSupported(): boolean;
    compute(input: ChannelImage, config?: Partial<ETFConfig>, sigmaC?: number): Promise<FlowField>;
    computeMultiChannel(inputs: ChannelImage[], config?: Partial<ETFConfig>, sigmaC?: number): Promise<FlowField>;
    /**
     * Release resources held by whichever backend this instance resolved to.
     * No-op if compute()/computeMultiChannel() was never called, since
     * nothing was ever instantiated.
     */
    dispose(): void;
    /**
     * Run `op` against the resolved backend, resolving (and caching) it on
     * first use. `op` is what actually drives selection in 'auto' mode: a
     * backend only "wins" once it has successfully produced a result, not
     * merely passed isSupported(), since WebGPU/WebGL can pass that cheap
     * check and still fail at adapter/device/shader-compile time.
     */
    private run;
}
export default EdgeTangentFlowComputer;
//# sourceMappingURL=index.d.ts.map