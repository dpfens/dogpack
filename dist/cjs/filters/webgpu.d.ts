/**
 * WebGPU-accelerated preprocessing module for XDoG/FDoG
 *
 * Even faster than WebGL implementations
 */
import { type ChannelImage, type BilateralFilterConfig, type MedianFilterConfig, type KuwaharaFilterConfig, type EdgeAwareFilterCore, type ContrastEnhancementConfig, type QuantizerConfig, type GaussianConfig } from '../interfaces/base.js';
import { BaseWebGPUStrategy } from '../base.js';
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
 * and is identical for every pixel. Computing it on the CPU once instead
 * of calling `exp()` for it on every shader invocation roughly halves the
 * transcendental-function work in the inner loop.
 */
export declare class GPUBilateralFilter extends BaseWebGPUStrategy implements EdgeAwareFilterCore<BilateralFilterConfig> {
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    apply(input: ChannelImage, config: Partial<BilateralFilterConfig>): Promise<ChannelImage>;
}
export declare class GPUMedianFilter extends BaseWebGPUStrategy implements EdgeAwareFilterCore<MedianFilterConfig> {
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    apply(input: ChannelImage, config: Partial<MedianFilterConfig>): Promise<ChannelImage>;
}
export declare class GPUKuwaharaFilter extends BaseWebGPUStrategy implements EdgeAwareFilterCore<KuwaharaFilterConfig> {
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    apply(input: ChannelImage, config: Partial<KuwaharaFilterConfig>): Promise<ChannelImage>;
}
export declare class GPUGaussianBlur extends BaseWebGPUStrategy implements EdgeAwareFilterCore<GaussianConfig> {
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    apply(input: ChannelImage, config: Partial<GaussianConfig>): Promise<ChannelImage>;
}
export declare class GPUContrastEnhancer extends BaseWebGPUStrategy implements EdgeAwareFilterCore<ContrastEnhancementConfig> {
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
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
     * both. The CPU-side histogram bucketing that happens between them
     * isn't GPU work, so it shouldn't sit inside a WebGPU error scope.
     */
    apply(input: ChannelImage, config: Partial<ContrastEnhancementConfig>): Promise<ChannelImage>;
}
export declare class GPUQuantizer extends BaseWebGPUStrategy implements EdgeAwareFilterCore<QuantizerConfig> {
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    apply(input: ChannelImage, config: Partial<QuantizerConfig>): Promise<ChannelImage>;
}
/**
 * Preset preprocessing pipelines for common use cases.
 * async GPU equivalents of `PreprocessingPresets` in cpu.ts.
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
//# sourceMappingURL=webgpu.d.ts.map