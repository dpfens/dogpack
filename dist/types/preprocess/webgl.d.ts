/**
 * WebGL-Accelerated Preprocessing Module for XDoG/FDoG
 *
 * High-performance GPU implementations of image preprocessing filters.
 * Achieves 50-100x speedup over CPU implementations for large images.
 *
 * Filters included:
 * - Bilateral Filter (edge-preserving smoothing)
 * - Median Filter (noise removal) - approximated via weighted histogram
 * - Kuwahara Filter (painterly effect)
 * - Gaussian Blur (separable, very fast)
 * - Contrast Enhancement
 * - Quantization
 */
import type { ChannelImage, BilateralFilterConfig, MedianFilterConfig, KuwaharaFilterConfig, Preprocessor } from '../types.js';
export declare class BilateralFilterWebGL implements Preprocessor {
    private readonly config;
    constructor(config?: Partial<BilateralFilterConfig>);
    process(input: ChannelImage): ChannelImage;
}
export declare class GaussianBlurWebGL implements Preprocessor {
    private readonly sigma;
    constructor(sigma?: number);
    process(input: ChannelImage): ChannelImage;
}
export declare class MedianFilterWebGL implements Preprocessor {
    private readonly config;
    constructor(config?: Partial<MedianFilterConfig>);
    process(input: ChannelImage): ChannelImage;
}
export declare class KuwaharaFilterWebGL implements Preprocessor {
    private readonly config;
    constructor(config?: Partial<KuwaharaFilterConfig>);
    process(input: ChannelImage): ChannelImage;
}
export declare class ContrastEnhancerWebGL implements Preprocessor {
    private readonly blackPoint;
    private readonly whitePoint;
    constructor(blackPoint?: number, whitePoint?: number);
    process(input: ChannelImage): ChannelImage;
}
export declare class QuantizerWebGL implements Preprocessor {
    private readonly levels;
    constructor(levels?: number);
    process(input: ChannelImage): ChannelImage;
}
export declare const PreprocessingPresetsWebGL: {
    light: (input: ChannelImage) => ChannelImage;
    standard: (input: ChannelImage) => ChannelImage;
    heavy: (input: ChannelImage) => ChannelImage;
    artistic: (input: ChannelImage) => ChannelImage;
    nature: (input: ChannelImage) => ChannelImage;
};
/**
 * Convenience class for chaining WebGL-accelerated preprocessing operations
 *
 * Note: renamed from `PreprocessorWebGL` to `PreprocessingPipelineWebGL`
 * since `Preprocessor` is now the shared strategy interface implemented by
 * BilateralFilterWebGL, MedianFilterWebGL, KuwaharaFilterWebGL,
 * GaussianBlurWebGL, ContrastEnhancerWebGL, and QuantizerWebGL above.
 */
export declare class PreprocessingPipelineWebGL {
    private operations;
    bilateral(config?: Partial<BilateralFilterConfig>): this;
    median(config?: Partial<MedianFilterConfig>): this;
    kuwahara(config?: Partial<KuwaharaFilterConfig>): this;
    gaussian(sigma?: number): this;
    contrast(blackPoint?: number, whitePoint?: number): this;
    quantize(levels?: number): this;
    /**
     * Add an arbitrary custom preprocessing strategy to the pipeline
     */
    use(preprocessor: Preprocessor): this;
    apply(input: ChannelImage): ChannelImage;
    clear(): this;
}
/**
 * Check if WebGL 2.0 is available
 */
export declare function isWebGLAvailable(): boolean;
/**
 * Cleanup all WebGL resources
 */
export declare function disposeWebGL(): void;
export { BilateralFilterWebGL as BilateralFilter, MedianFilterWebGL as MedianFilter, KuwaharaFilterWebGL as KuwaharaFilter, GaussianBlurWebGL as GaussianBlur, ContrastEnhancerWebGL as ContrastEnhancer, QuantizerWebGL as Quantizer, PreprocessingPresetsWebGL as PreprocessingPresets, PreprocessingPipelineWebGL as PreprocessingPipeline, };
//# sourceMappingURL=webgl.d.ts.map