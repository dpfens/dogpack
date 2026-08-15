/**
 * Shared machinery for "pick the best supported backend, fall back
 * gracefully if it fails later" filters.
 */
import type { ChannelImage, EdgeAwareFilterCore, EdgeAwareFilterCtor } from '../interfaces/base.js';
export declare abstract class ResilientEdgeAwareFilter<TOptions> implements EdgeAwareFilterCore<TOptions> {
    private readonly candidates;
    private readonly config;
    private readonly failedBackends;
    private instance;
    private currentCtor;
    /**
     * Subclasses resolve their instance via `resolve()` *before* calling
     * this (in their own async static `create()`), then hand the result in
     * here. The constructor itself stays synchronous, as constructors must.
     */
    protected constructor(candidates: readonly EdgeAwareFilterCtor<TOptions>[], resolved: {
        instance: EdgeAwareFilterCore<TOptions>;
        ctor: EdgeAwareFilterCtor<TOptions>;
    }, config: TOptions);
    /**
     * Try each candidate in order, skipping unsupported ones. If a
     * candidate reports supported but throws on construction anyway
     * (isSupported() lied), move on to the next.
     */
    protected static resolve<TOptions>(candidates: readonly EdgeAwareFilterCtor<TOptions>[], config: TOptions): Promise<{
        instance: EdgeAwareFilterCore<TOptions>;
        ctor: EdgeAwareFilterCtor<TOptions>;
    }>;
    get backend(): "cpu" | "webgl" | "webgpu";
    dispose(): void;
    apply(input: ChannelImage, options: TOptions): Promise<ChannelImage>;
    private demoteAndFindNext;
}
//# sourceMappingURL=resilient-filter.d.ts.map