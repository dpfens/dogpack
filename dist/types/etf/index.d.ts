import type { ETFComputer, ETFConfig, FlowField, ChannelImage } from '../interfaces/base.js';
/**
 * Edge Tangent Flow computer that automatically resolves to the best
 * supported backend, with graceful single-retry fallback if that backend
 * fails after selection (driver crash, lost context, etc).
 *
 */
export declare class EdgeTangentFlowComputer implements ETFComputer {
    private instance;
    private currentCtor;
    private failedBackends;
    private constructor();
    private static readonly candidates;
    static create(): Promise<EdgeTangentFlowComputer>;
    /**
     * Which backend is actually running right now. Can change over the
     * life of this instance if a fallback occurs mid-session.
     */
    get backend(): "cpu" | "webgl" | "webgpu";
    dispose(): void;
    /**
     * Compute an Edge Tangent Flow. The returned FlowField carries its own
     * magnitude/anisotropy (see interfaces/base.ts) — there is no separate
     * "detailed" variant anymore.
     */
    compute(input: ChannelImage, config?: Partial<ETFConfig>, sigmaC?: number): Promise<FlowField>;
    computeMultiChannel(inputs: ChannelImage[], config?: Partial<ETFConfig>, sigmaC?: number): Promise<FlowField>;
    callWithFallback<T>(op: (computer: ETFComputer) => Promise<T>): Promise<T>;
    private demoteAndFindNext;
}
export default EdgeTangentFlowComputer;
//# sourceMappingURL=index.d.ts.map