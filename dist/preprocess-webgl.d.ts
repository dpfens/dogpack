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
import { GrayscaleImage, BilateralFilterConfig, MedianFilterConfig, KuwaharaFilterConfig } from './types.js';
export declare function bilateralFilterWebGL(input: GrayscaleImage, config: BilateralFilterConfig): GrayscaleImage;
export declare function gaussianBlurWebGL(input: GrayscaleImage, sigma?: number): GrayscaleImage;
export declare function medianFilterWebGL(input: GrayscaleImage, config: MedianFilterConfig): GrayscaleImage;
export declare function kuwaharaFilterWebGL(input: GrayscaleImage, config: KuwaharaFilterConfig): GrayscaleImage;
export declare function enhanceContrastWebGL(input: GrayscaleImage, blackPoint?: number, whitePoint?: number): GrayscaleImage;
export declare function quantizeWebGL(input: GrayscaleImage, levels?: number): GrayscaleImage;
export declare const PreprocessingPresetsWebGL: {
    light: (input: GrayscaleImage) => GrayscaleImage;
    standard: (input: GrayscaleImage) => GrayscaleImage;
    heavy: (input: GrayscaleImage) => GrayscaleImage;
    artistic: (input: GrayscaleImage) => GrayscaleImage;
    nature: (input: GrayscaleImage) => GrayscaleImage;
};
export declare class PreprocessorWebGL {
    private operations;
    bilateral(config?: Partial<BilateralFilterConfig>): this;
    median(config?: Partial<MedianFilterConfig>): this;
    kuwahara(config?: Partial<KuwaharaFilterConfig>): this;
    gaussian(sigma?: number): this;
    contrast(blackPoint?: number, whitePoint?: number): this;
    quantize(levels?: number): this;
    apply(input: GrayscaleImage): GrayscaleImage;
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