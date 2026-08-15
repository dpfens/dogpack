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
import { type ChannelImage, type BilateralFilterConfig, type MedianFilterConfig, type KuwaharaFilterConfig } from '../interfaces/base.js';
import { BaseCPUStrategy } from '../base.js';
import type { ContrastEnhancementConfig, EdgeAwareFilterCore, GaussianConfig, LocalVarianceConfig, QuantizerConfig } from '../interfaces/base.js';
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
 * backend all apply unchanged). This is the universal fallback.
 */
export declare class BilateralFilter extends BaseCPUStrategy implements EdgeAwareFilterCore<BilateralFilterConfig> {
    apply(input: ChannelImage, config: Partial<BilateralFilterConfig>): Promise<ChannelImage>;
}
/**
 * Median Filter
 *
 * Replaces each pixel with the median of its neighborhood.
 * Excellent for removing salt-and-pepper noise and small texture details.
 */
export declare class MedianFilter extends BaseCPUStrategy implements EdgeAwareFilterCore<MedianFilterConfig> {
    apply(input: ChannelImage, config: Partial<MedianFilterConfig>): Promise<ChannelImage>;
}
/**
 * Kuwahara Filter
 *
 * Artistic smoothing filter that creates a painterly effect.
 * Divides the neighborhood into 4 quadrants, finds the one with
 * lowest variance, and uses its mean. Creates flat regions with
 * preserved edges - great for a more stylized look.
 */
export declare class KuwaharaFilter extends BaseCPUStrategy implements EdgeAwareFilterCore<KuwaharaFilterConfig> {
    apply(input: ChannelImage, config: Partial<KuwaharaFilterConfig>): Promise<ChannelImage>;
}
/**
 * Gaussian Blur
 *
 * Simple Gaussian smoothing. Less edge-preserving than bilateral,
 * but faster. Good for very noisy images or when used with small sigma.
 */
export declare class GaussianBlur extends BaseCPUStrategy implements EdgeAwareFilterCore<GaussianConfig> {
    apply(input: ChannelImage, config: Partial<GaussianConfig>): Promise<ChannelImage>;
}
/**
 * Contrast Enhancement
 *
 * Stretches the histogram to use the full 0-1 range.
 * Can help make edges more distinct before processing.
 */
export declare class ContrastEnhancer extends BaseCPUStrategy implements EdgeAwareFilterCore<ContrastEnhancementConfig> {
    apply(input: ChannelImage, config: Partial<ContrastEnhancementConfig>): Promise<ChannelImage>;
}
/**
 * Quantize to reduce color levels
 *
 * Reduces the number of intensity levels, creating a posterized effect.
 * Can help reduce noise by grouping similar intensities together.
 */
export declare class Quantizer extends BaseCPUStrategy implements EdgeAwareFilterCore<QuantizerConfig> {
    apply(input: ChannelImage, config: Partial<QuantizerConfig>): Promise<ChannelImage>;
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
 * const filter = new LocalVarianceFilter({
 *   windowRadius: 2,
 *   normalizeByGradient: true,
 * });
 *
 * const textureMap = filter.apply(grayImage);
 * // textureMap.data[i] = texture strength at pixel i
 * // Now use textureMap with your own edge detection
 * ```
 */
export declare class LocalVarianceFilter implements EdgeAwareFilterCore<LocalVarianceConfig> {
    /** CPU-only. No WebGL/WebGPU counterparts for this yet. */
    readonly backend: "cpu";
    defaultConfig: LocalVarianceConfig;
    dispose(): void;
    /**
     * Process using separable convolution (faster for large windows)
     * Variance = E[X^2] - E[X]^2
     * Compute box blur of X and X^2 separately, then combine
     */
    apply(image: ChannelImage, config: Partial<LocalVarianceConfig>): Promise<ChannelImage>;
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
     * radii (1-4) this filter supports.
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
export declare const EdgeAwareFilterPresets: {
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
//# sourceMappingURL=cpu.d.ts.map