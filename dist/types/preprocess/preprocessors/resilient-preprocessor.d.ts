/**
 * Shared machinery for "pick the best supported backend, fall back
 * gracefully if it fails later" preprocessors.
 */
import type { ChannelImage, Preprocessor, PreprocessorCtor } from '../../interfaces/base.js';
export declare abstract class ResilientPreprocessor<TConfig> implements Preprocessor {
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
    protected constructor(candidates: readonly PreprocessorCtor[], resolved: {
        instance: Preprocessor;
        ctor: PreprocessorCtor;
    }, config: TConfig);
    /**
     * Try each candidate in order, skipping unsupported ones. If a
     * candidate reports supported but throws on construction anyway
     * (isSupported() lied), move on to the next.
     */
    protected static resolve<TConfig>(candidates: readonly PreprocessorCtor[], config: TConfig): Promise<{
        instance: Preprocessor;
        ctor: PreprocessorCtor;
    }>;
    get backend(): "cpu" | "webgl" | "webgpu";
    dispose(): void;
    process(input: ChannelImage): Promise<ChannelImage>;
    private demoteAndFindNext;
}
//# sourceMappingURL=resilient-preprocessor.d.ts.map