/**
 * Preprocessing module for XDoG/FDoG
 *
 * Provides filters to prepare images before line detection.
 * These help reduce noise and texture while preserving important edges.
 *
 * Section 3.2 of the paper discusses the importance of bilateral
 * preprocessing for "indication" - attenuating weak edges while
 * preserving strong edges.
 */
import { GrayscaleImage } from './types.js';
/**
 * Configuration for bilateral filter
 */
export interface BilateralFilterConfig {
    /** Spatial sigma - controls the size of the neighborhood (default: 3) */
    sigmaSpatial: number;
    /** Range/intensity sigma - controls sensitivity to intensity differences (default: 0.1) */
    sigmaRange: number;
    /** Kernel radius multiplier (default: 2, meaning radius = sigmaSpatial * 2) */
    radiusMultiplier: number;
}
/**
 * Configuration for median filter
 */
export interface MedianFilterConfig {
    /** Radius of the filter (default: 2, meaning 5x5 kernel) */
    radius: number;
}
/**
 * Configuration for Kuwahara filter
 */
export interface KuwaharaFilterConfig {
    /** Radius of the filter (default: 3) */
    radius: number;
}
/**
 * Bilateral Filter
 *
 * Edge-preserving smoothing filter that averages pixels based on both
 * spatial proximity AND intensity similarity. This smooths out texture
 * (like grass) while keeping strong edges (like the car outline) sharp.
 *
 * This is the recommended preprocessing for most images.
 *
 * As mentioned in Section 3.2, bilateral filtering can serve as a
 * "prioritization mechanism" for indication - attenuating weak edges
 * while supporting strong edges.
 */
export declare function bilateralFilter(input: GrayscaleImage, config?: Partial<BilateralFilterConfig>): GrayscaleImage;
/**
 * Median Filter
 *
 * Replaces each pixel with the median of its neighborhood.
 * Excellent for removing salt-and-pepper noise and small texture details.
 */
export declare function medianFilter(input: GrayscaleImage, config?: Partial<MedianFilterConfig>): GrayscaleImage;
/**
 * Kuwahara Filter
 *
 * Artistic smoothing filter that creates a painterly effect.
 * Divides the neighborhood into 4 quadrants, finds the one with
 * lowest variance, and uses its mean. Creates flat regions with
 * preserved edges - great for a more stylized look.
 */
export declare function kuwaharaFilter(input: GrayscaleImage, config?: Partial<KuwaharaFilterConfig>): GrayscaleImage;
/**
 * Gaussian Blur
 *
 * Simple Gaussian smoothing. Less edge-preserving than bilateral,
 * but faster. Good for very noisy images or when used with small sigma.
 */
export declare function gaussianBlur(input: GrayscaleImage, sigma?: number): GrayscaleImage;
/**
 * Contrast Enhancement
 *
 * Stretches the histogram to use the full 0-1 range.
 * Can help make edges more distinct before processing.
 */
export declare function enhanceContrast(input: GrayscaleImage, blackPoint?: number, whitePoint?: number): GrayscaleImage;
/**
 * Quantize to reduce color levels
 *
 * Reduces the number of intensity levels, creating a posterized effect.
 * Can help reduce noise by grouping similar intensities together.
 */
export declare function quantize(input: GrayscaleImage, levels?: number): GrayscaleImage;
/**
 * Preset preprocessing pipelines for common use cases
 */
export declare const PreprocessingPresets: {
    /**
     * Light preprocessing - minimal smoothing
     * Good for: Clean studio photos, illustrations
     */
    light: (input: GrayscaleImage) => GrayscaleImage;
    /**
     * Standard preprocessing - balanced smoothing
     * Good for: Most outdoor photos, portraits
     */
    standard: (input: GrayscaleImage) => GrayscaleImage;
    /**
     * Heavy preprocessing - aggressive noise removal
     * Good for: Very textured images (grass, foliage, fabric)
     */
    heavy: (input: GrayscaleImage) => GrayscaleImage;
    /**
     * Artistic preprocessing - painterly smoothing
     * Good for: Stylized/artistic output
     */
    artistic: (input: GrayscaleImage) => GrayscaleImage;
    /**
     * Photo preprocessing - for photos with grass/nature
     * Good for: Landscape, outdoor scenes
     */
    nature: (input: GrayscaleImage) => GrayscaleImage;
};
/**
 * Convenience class for chaining preprocessing operations
 */
export declare class Preprocessor {
    private operations;
    /**
     * Add bilateral filter to the pipeline
     */
    bilateral(config?: Partial<BilateralFilterConfig>): this;
    /**
     * Add median filter to the pipeline
     */
    median(config?: Partial<MedianFilterConfig>): this;
    /**
     * Add Kuwahara filter to the pipeline
     */
    kuwahara(config?: Partial<KuwaharaFilterConfig>): this;
    /**
     * Add Gaussian blur to the pipeline
     */
    gaussian(sigma?: number): this;
    /**
     * Add contrast enhancement to the pipeline
     */
    contrast(blackPoint?: number, whitePoint?: number): this;
    /**
     * Add quantization to the pipeline
     */
    quantize(levels?: number): this;
    /**
     * Apply all operations in sequence
     */
    apply(input: GrayscaleImage): GrayscaleImage;
    /**
     * Clear all operations
     */
    clear(): this;
}
//# sourceMappingURL=preprocess.d.ts.map