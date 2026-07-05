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
import { ChannelImage, BilateralFilterConfig, MedianFilterConfig, KuwaharaFilterConfig } from './types.js';
export declare function bilateralFilterWebGL(input: ChannelImage, config: BilateralFilterConfig): ChannelImage;
export declare function gaussianBlurWebGL(input: ChannelImage, sigma?: number): ChannelImage;
export declare function medianFilterWebGL(input: ChannelImage, config: MedianFilterConfig): ChannelImage;
export declare function kuwaharaFilterWebGL(input: ChannelImage, config: KuwaharaFilterConfig): ChannelImage;
export declare function enhanceContrastWebGL(input: ChannelImage, blackPoint?: number, whitePoint?: number): ChannelImage;
export declare function quantizeWebGL(input: ChannelImage, levels?: number): ChannelImage;
export declare const PreprocessingPresetsWebGL: {
    light: (input: ChannelImage) => ChannelImage;
    standard: (input: ChannelImage) => ChannelImage;
    heavy: (input: ChannelImage) => ChannelImage;
    artistic: (input: ChannelImage) => ChannelImage;
    nature: (input: ChannelImage) => ChannelImage;
};
export declare class PreprocessorWebGL {
    private operations;
    bilateral(config?: Partial<BilateralFilterConfig>): this;
    median(config?: Partial<MedianFilterConfig>): this;
    kuwahara(config?: Partial<KuwaharaFilterConfig>): this;
    gaussian(sigma?: number): this;
    contrast(blackPoint?: number, whitePoint?: number): this;
    quantize(levels?: number): this;
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
export { bilateralFilterWebGL as bilateralFilter, medianFilterWebGL as medianFilter, kuwaharaFilterWebGL as kuwaharaFilter, gaussianBlurWebGL as gaussianBlur, enhanceContrastWebGL as enhanceContrast, quantizeWebGL as quantize, PreprocessingPresetsWebGL as PreprocessingPresets, PreprocessorWebGL as Preprocessor, };
//# sourceMappingURL=preprocess-webgl.d.ts.map