/**
 * Local variance-based texture detection preprocessor for XDoG/FDoG edge detection.
 *
 * @remarks
 * Standard XDoG/FDoG apply the same parameters across an entire image, so
 * textured regions (fabric, foliage, skin) produce false edges alongside
 * genuine structural ones. This module addresses that by computing a texture
 * strength map — a {@link ChannelImage} whose values range from `0` (pure
 * structure) to `1` (pure texture) — from the local variance in a window
 * around each pixel, optionally normalized by the local gradient so that
 * subtle structural edges (e.g. wrinkles) aren't mistaken for texture.
 */
import type { ChannelImage, Preprocessor } from "../interfaces/base.js";
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
     * Compute texture strength map from image
     *
     * @param image Input grayscale image (Float32Array, 0-1 normalized)
     * @returns ChannelImage containing texture strength values
     *          Each pixel: 0 = pure structure (edges, boundaries)
     *                     1 = pure texture (patterns, fine details)
     *          Developer uses these values to adapt XDoG parameters
     */
    process(image: ChannelImage): Promise<ChannelImage>;
    /**
     * Compute variance of pixel values in a window
     * @private
     */
    private computeLocalVariance;
    /**
     * Compute gradient magnitude at pixel (Sobel filter)
     * Used to normalize variance (distinguish texture from edges)
     * @private
     */
    private computeLocalGradient;
}
/**
 * Optimized Local Variance Texture Detector
 *
 * Same functionality as LocalVariancePreprocessor, but faster.
 * Uses separable convolution: O(n x r) instead of O(n x r^2)
 *
 * Approach: Variance = E[X^2] - E[X]^2
 * - Compute box blur of image (gives E[X])
 * - Compute box blur of image squared (gives E[X^2])
 * - Subtract to get variance
 *
 * Performance:
 * - Basic version: ~1-2ms for 1080p (5x5 window)
 * - Optimized version: ~0.5ms for 1080p (5x5 window)
 * - 3-4x faster for large windows
 *
 * Use this for real-time applications. Basic version is fine for batch processing.
 */
export declare class LocalVariancePreprocessorOptimized implements Preprocessor {
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
//# sourceMappingURL=local-variance.d.ts.map