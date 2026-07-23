/**
 * Strategy pattern for parameter maps -- plain classes, matching how
 * every Preprocessor/BlurStrategy elsewhere in this codebase is written.
 * `param` is the swap contract: ParameterMapPipeline.set() and
 * CompositeStrategy both check it before wiring a strategy in.
 */
import type { ChannelImage, Preprocessor, Disposable } from '../interfaces/base.js';
import { type LocalVarianceConfig } from '../preprocess/local-variance.js';
import { type StructureTensorMaps } from './structure-tensor.js';
export type DogMapParam = 'p' | 'epsilon' | 'phi';
export interface ParameterMapStrategy extends Disposable {
    readonly param: DogMapParam;
    compute(input: ChannelImage): Promise<ChannelImage>;
}
/** Local-variance texture. High texture -> low p / high epsilon. */
export declare class TextureStrategy implements ParameterMapStrategy {
    readonly param: 'p' | 'epsilon';
    private readonly opts;
    private readonly config;
    constructor(param: 'p' | 'epsilon', opts: {
        low: number;
        high: number;
    }, config?: Partial<LocalVarianceConfig>);
    compute(input: ChannelImage): Promise<ChannelImage>;
    dispose(): void;
}
/** Tone map (broad blur). Dark -> low epsilon (denser shading), light -> high epsilon. */
export declare class LuminanceStrategy implements ParameterMapStrategy {
    private readonly opts;
    readonly param: "epsilon";
    private blurPromise?;
    constructor(opts: {
        epsilonDark: number;
        epsilonLight: number;
        blurSigma?: number;
    });
    compute(input: ChannelImage): Promise<ChannelImage>;
    dispose(): void;
}
/** |input - filter(input)| for any injected edge-preserving filter (Bilateral, Kuwahara, ...). */
export declare class DetailResidualStrategy implements ParameterMapStrategy {
    readonly param: 'p' | 'epsilon';
    private readonly filter;
    private readonly opts;
    constructor(param: 'p' | 'epsilon', filter: Preprocessor, opts: {
        low: number;
        high: number;
    });
    compute(input: ChannelImage): Promise<ChannelImage>;
    dispose(): void;
}
/** Structure-tensor magnitude. High confidence -> low epsilon (let it through easily). */
export declare class StructureTensorMagnitudeStrategy implements ParameterMapStrategy {
    private readonly cache;
    private readonly opts;
    readonly param: "epsilon";
    constructor(cache: StructureTensorCache, opts: {
        epsilonLow: number;
        epsilonHigh: number;
        saturateAt: number;
    });
    compute(input: ChannelImage): Promise<ChannelImage>;
    dispose(): void;
}
/** Structure-tensor anisotropy. Coherent line -> high phi (crisp binary). */
export declare class StructureTensorAnisotropyStrategy implements ParameterMapStrategy {
    private readonly cache;
    private readonly opts;
    readonly param: "phi";
    constructor(cache: StructureTensorCache, opts: {
        phiLow: number;
        phiHigh: number;
    });
    compute(input: ChannelImage): Promise<ChannelImage>;
    dispose(): void;
}
/**
 * Shared per-input tensor cache, keyed by ChannelImage reference. Magnitude
 * and anisotropy strategies both read from the same e/f/g, so wiring them
 * to one cache (via structureTensorStrategies() below) avoids computing
 * the tensor twice per frame.
 */
declare class StructureTensorCache {
    private readonly smoothingRadius;
    private readonly cache;
    constructor(smoothingRadius: number);
    get(input: ChannelImage): StructureTensorMaps;
}
/** Builds the magnitude/anisotropy pair sharing one StructureTensorCache. */
export declare function structureTensorStrategies(opts: {
    smoothingRadius?: number;
    epsilon: {
        epsilonLow: number;
        epsilonHigh: number;
        saturateAt: number;
    };
    phi: {
        phiLow: number;
        phiHigh: number;
    };
}): {
    magnitude: StructureTensorMagnitudeStrategy;
    anisotropy: StructureTensorAnisotropyStrategy;
};
/** Combines strategies driving the same param. `mode: 'blend'` averages
 *  independent votes; `'requireAll'` multiplies, so each acts as a veto. */
export declare class CompositeStrategy implements ParameterMapStrategy {
    readonly param: DogMapParam;
    private readonly entries;
    private readonly mode;
    constructor(param: DogMapParam, entries: Array<{
        strategy: ParameterMapStrategy;
        weight?: number;
    }>, mode?: 'blend' | 'requireAll');
    compute(input: ChannelImage): Promise<ChannelImage>;
    dispose(): void;
}
/** Registers a strategy per param; `build()` produces DoGConfig-ready overrides. */
export declare class ParameterMapPipeline implements Disposable {
    private readonly strategies;
    constructor(strategies: Partial<Record<DogMapParam, ParameterMapStrategy>>);
    build(input: ChannelImage): Promise<Partial<Record<DogMapParam, ChannelImage>>>;
    /** Swap the strategy registered for a param, disposing the old one. */
    set(param: DogMapParam, strategy: ParameterMapStrategy): void;
    dispose(): void;
}
export {};
//# sourceMappingURL=strategies.d.ts.map