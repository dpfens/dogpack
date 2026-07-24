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
import type { ChannelImage, BilateralFilterConfig, MedianFilterConfig, KuwaharaFilterConfig, Preprocessor } from '../../interfaces/base.js';
import { BaseCPUStrategy } from '../../base.js';
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
 *
 * CPU is always available (BaseCPUStrategy.isSupported() / dispose() /
 * backend all apply unchanged) — this is the universal fallback.
 */
export declare class BilateralFilter extends BaseCPUStrategy implements Preprocessor {
    private readonly config;
    constructor(config?: Partial<BilateralFilterConfig>);
    process(input: ChannelImage): Promise<ChannelImage>;
}
/**
 * Median Filter
 *
 * Replaces each pixel with the median of its neighborhood.
 * Excellent for removing salt-and-pepper noise and small texture details.
 */
export declare class MedianFilter extends BaseCPUStrategy implements Preprocessor {
    private readonly config;
    constructor(config?: Partial<MedianFilterConfig>);
    process(input: ChannelImage): Promise<ChannelImage>;
}
/**
 * Kuwahara Filter
 *
 * Artistic smoothing filter that creates a painterly effect.
 * Divides the neighborhood into 4 quadrants, finds the one with
 * lowest variance, and uses its mean. Creates flat regions with
 * preserved edges - great for a more stylized look.
 */
export declare class KuwaharaFilter extends BaseCPUStrategy implements Preprocessor {
    private readonly config;
    constructor(config?: Partial<KuwaharaFilterConfig>);
    process(input: ChannelImage): Promise<ChannelImage>;
}
/**
 * Gaussian Blur
 *
 * Simple Gaussian smoothing. Less edge-preserving than bilateral,
 * but faster. Good for very noisy images or when used with small sigma.
 */
export declare class GaussianBlur extends BaseCPUStrategy implements Preprocessor {
    private readonly sigma;
    constructor(sigma?: number);
    process(input: ChannelImage): Promise<ChannelImage>;
}
/**
 * Contrast Enhancement
 *
 * Stretches the histogram to use the full 0-1 range.
 * Can help make edges more distinct before processing.
 */
export declare class ContrastEnhancer extends BaseCPUStrategy implements Preprocessor {
    private readonly blackPoint;
    private readonly whitePoint;
    constructor(blackPoint?: number, whitePoint?: number);
    process(input: ChannelImage): Promise<ChannelImage>;
}
/**
 * Quantize to reduce color levels
 *
 * Reduces the number of intensity levels, creating a posterized effect.
 * Can help reduce noise by grouping similar intensities together.
 */
export declare class Quantizer extends BaseCPUStrategy implements Preprocessor {
    private readonly levels;
    constructor(levels?: number);
    process(input: ChannelImage): Promise<ChannelImage>;
}
/**
 * Configuration for Local Variance Texture Detection
 *
 * These parameters control how texture is detected. They are independent
 * from XDoG/FDoG/HDoG parameters - you tune them separately based on the
 * image characteristics you're working with.
 */
export interface LocalVarianceConfig {
    /**
     * Window radius for variance computation
     * Examples:
     * - 1 = 3x3 window (fast, fine detail)
     * - 2 = 5x5 window (recommended, balanced)
     * - 3 = 7x7 window (slower, coarser texture detection)
     */
    windowRadius: number;
    /**
     * Normalize by local gradient to distinguish texture from structure edges
     *
     * Without normalization:
     *   - High variance alone indicates texture
     *   - Problem: Subtle structural edges with variance get suppressed
     *
     * With normalization:
     *   - High variance + low gradient = texture (keep)
     *   - High variance + high gradient = edge (reduce texture score)
     *   - Formula: texture *= 1 / (1 + gradient^2)
     *
     * Recommended: true
     */
    normalizeByGradient: boolean;
    /**
     * Scale factor for raw variance values
     * Typical range: 1.0 - 3.0
     * Higher = more sensitive to texture variations
     * Output is clamped to [0, 1] after scaling
     */
    varianceScale: number;
    /**
     * Optional hard cap on variance values (before normalization)
     * Prevents outliers from dominating
     * If undefined, no capping is applied
     */
    maxVariance?: number;
}
/**
 * Computes local variance as texture detection preprocessing
 *
 * STANDALONE PREPROCESSING: This class only detects texture.
 * It does NOT perform edge detection.
 *
 * Input: ChannelImage (typically grayscale image)
 * Output: ChannelImage with same dimensions where each pixel value
 *         represents texture strength (0 = pure structure, 1 = pure texture)
 *
 * The output can be:
 * 1. Passed to your XDoG/FDoG/HDoG implementation to modulate parameters
 * 2. Combined with other texture detection methods (Spectral, Patch-based)
 * 3. Visualized for debugging
 * 4. Processed through additional preprocessing steps
 *
 * Example:
 * ```
 * const preprocessor = new LocalVariancePreprocessor({
 *   windowRadius: 2,
 *   normalizeByGradient: true,
 * });
 *
 * const textureMap = preprocessor.process(grayImage);
 * // textureMap.data[i] = texture strength at pixel i
 * // Now use textureMap with your own edge detection
 * ```
 */
export declare class LocalVariancePreprocessor implements Preprocessor {
    private config;
    /** CPU-only — no WebGL/WebGPU counterpart exists for this preprocessor. */
    readonly backend: "cpu";
    constructor(config?: Partial<LocalVarianceConfig>);
    dispose(): void;
    /**
     * Process using separable convolution (faster for large windows)
     * Variance = E[X^2] - E[X]^2
     * Compute box blur of X and X^2 separately, then combine
     */
    process(image: ChannelImage): Promise<ChannelImage>;
    /**
     * Fast box blur using separable convolution + a sliding-window running sum.
     *
     * @remarks
     * Each pass is O(width * height): the window sum is updated incrementally
     * as it slides one pixel over (`sum += incoming - outgoing`) rather than
     * being re-summed from scratch at every position, so cost no longer grows
     * with `radius`. Edge pixels use clamp-to-edge boundary handling.
     *
     * Trade-off: because each sum is derived from the previous one instead of
     * being recomputed from scratch, floating-point error can accumulate along
     * a scan line, unlike the resum-per-pixel approach this replaces. This is
     * negligible in practice for 0-1 normalized pixel values and the small
     * radii (1-4) this preprocessor supports.
     *
     * @private
     */
    private boxBlur;
    /**
     * Compute gradient map using Sobel filter (separable for efficiency)
     * @private
     */
    private computeGradientMap;
}
/**
 * Preset preprocessing pipelines for common use cases
 */
export declare const PreprocessingPresets: {
    /**
     * Light preprocessing - minimal smoothing
     * Good for: Clean studio photos, illustrations
     */
    light: (input: ChannelImage) => Promise<ChannelImage>;
    /**
     * Standard preprocessing - balanced smoothing
     * Good for: Most outdoor photos, portraits
     */
    standard: (input: ChannelImage) => Promise<ChannelImage>;
    /**
     * Heavy preprocessing - aggressive noise removal
     * Good for: Very textured images (grass, foliage, fabric)
     */
    heavy: (input: ChannelImage) => Promise<ChannelImage>;
    /**
     * Artistic preprocessing - painterly smoothing
     * Good for: Stylized/artistic output
     */
    artistic: (input: ChannelImage) => Promise<ChannelImage>;
    /**
     * Photo preprocessing - for photos with grass/nature
     * Good for: Landscape, outdoor scenes
     */
    nature: (input: ChannelImage) => Promise<ChannelImage>;
};
/**
 * Convenience class for chaining preprocessing operations
 */
export declare class PreprocessingPipeline {
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
     * Add an arbitrary custom preprocessing strategy to the pipeline
     */
    use(preprocessor: Preprocessor): this;
    /**
     * Apply all operations in sequence
     */
    apply(input: ChannelImage): Promise<ChannelImage>;
    /**
     * Clear all operations
     */
    clear(): this;
}
//# sourceMappingURL=cpu.d.ts.map