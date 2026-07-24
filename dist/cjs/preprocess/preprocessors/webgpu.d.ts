/**
 * WebGPU-accelerated preprocessing module for XDoG/FDoG
 *
 * Even faster than WebGL implementations
 */
import type { ChannelImage, BilateralFilterConfig, MedianFilterConfig, KuwaharaFilterConfig, Preprocessor } from '../../interfaces/base.js';
import { BaseWebGPUStrategy } from '../../base.js';
/**
 * Deeper async check: confirms an adapter is actually obtainable, not
 * just that `navigator.gpu` exists.
 */
export declare function getWebGPUUnsupportedReason(): Promise<string | undefined>;
/** Release the cached device. Mainly useful for tests / hot reload. */
export declare function disposeWebGPU(): void;
export declare function clearShaderCaches(): void;
/**
 * The `rowOffset` field lets a single dispatch cover only a band of rows
 * of a much taller image (see the chunking loop in `process()` below).
 * `spatialWeights` is a precomputed (2*radius+1)^2 lookup table for the
 * spatial term of the bilateral weight, which depends only on (dx, dy)
 * and is identical for every pixel — computing it on the CPU once instead
 * of calling `exp()` for it on every shader invocation roughly halves the
 * transcendental-function work in the inner loop.
 */
export declare class GPUBilateralFilter extends BaseWebGPUStrategy implements Preprocessor {
    private readonly config;
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    constructor(config?: Partial<BilateralFilterConfig>);
    process(input: ChannelImage): Promise<ChannelImage>;
}
export declare class GPUMedianFilter extends BaseWebGPUStrategy implements Preprocessor {
    private readonly config;
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    constructor(config?: Partial<MedianFilterConfig>);
    process(input: ChannelImage): Promise<ChannelImage>;
}
export declare class GPUKuwaharaFilter extends BaseWebGPUStrategy implements Preprocessor {
    private readonly config;
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    constructor(config?: Partial<KuwaharaFilterConfig>);
    process(input: ChannelImage): Promise<ChannelImage>;
}
export declare class GPUGaussianBlur extends BaseWebGPUStrategy implements Preprocessor {
    private readonly sigma;
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    constructor(sigma?: number);
    process(input: ChannelImage): Promise<ChannelImage>;
}
export declare class GPUContrastEnhancer extends BaseWebGPUStrategy implements Preprocessor {
    private readonly blackPoint;
    private readonly whitePoint;
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    constructor(blackPoint?: number, whitePoint?: number);
    /**
     * The CPU version sorts every pixel to find exact percentiles. Sorting
     * is a poor fit for a GPU compute pass, so this builds a 256-bin
     * histogram instead (one atomicAdd per pixel), reads the 1KB histogram
     * back to the CPU to locate the percentile bins, then runs a second,
     * fully GPU-resident pass to apply the stretch. This trades a small
     * amount of precision (bin width 1/255) for O(n) work instead of an
     * O(n log n) sort, at the cost of one small CPU/GPU sync point.
     *
     * The two GPU round-trips (histogram pass, then stretch pass) are each
     * wrapped in their own runGuarded scope rather than one scope spanning
     * both — the CPU-side histogram bucketing that happens between them
     * isn't GPU work, so it shouldn't sit inside a WebGPU error scope.
     */
    process(input: ChannelImage): Promise<ChannelImage>;
}
export declare class GPUQuantizer extends BaseWebGPUStrategy implements Preprocessor {
    private readonly levels;
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    constructor(levels?: number);
    process(input: ChannelImage): Promise<ChannelImage>;
}
/**
 * Preset preprocessing pipelines for common use cases — async GPU
 * equivalents of `PreprocessingPresets` in cpu.ts.
 */
export declare const GPUPreprocessingPresets: {
    /** Light preprocessing - minimal smoothing. Good for clean studio photos, illustrations. */
    light: (input: ChannelImage) => Promise<ChannelImage>;
    /** Standard preprocessing - balanced smoothing. Good for most outdoor photos, portraits. */
    standard: (input: ChannelImage) => Promise<ChannelImage>;
    /** Heavy preprocessing - aggressive noise removal. Good for very textured images. */
    heavy: (input: ChannelImage) => Promise<ChannelImage>;
    /** Artistic preprocessing - painterly smoothing. Good for stylized/artistic output. */
    artistic: (input: ChannelImage) => Promise<ChannelImage>;
    /** Photo preprocessing - for photos with grass/nature. Good for landscape, outdoor scenes. */
    nature: (input: ChannelImage) => Promise<ChannelImage>;
};
/**
 * Convenience class for chaining GPU preprocessing operations — async
 * equivalent of `PreprocessingPipeline` in cpu.ts.
 */
export declare class GPUPreprocessingPipeline {
    private operations;
    bilateral(config?: Partial<BilateralFilterConfig>): this;
    median(config?: Partial<MedianFilterConfig>): this;
    kuwahara(config?: Partial<KuwaharaFilterConfig>): this;
    gaussian(sigma?: number): this;
    contrast(blackPoint?: number, whitePoint?: number): this;
    quantize(levels?: number): this;
    /** Add an arbitrary custom async preprocessing strategy to the pipeline. */
    use(preprocessor: Preprocessor): this;
    /** Apply all operations in sequence, awaiting each GPU round-trip. */
    apply(input: ChannelImage): Promise<ChannelImage>;
    clear(): this;
}
//# sourceMappingURL=webgpu.d.ts.map