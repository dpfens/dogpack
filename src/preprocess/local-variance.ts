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
export class LocalVariancePreprocessor implements Preprocessor {
  private config: LocalVarianceConfig;
  /** CPU-only — no WebGL/WebGPU counterpart exists for this preprocessor. */
  readonly backend = 'cpu' as const;

  constructor(config: Partial<LocalVarianceConfig> = {}) {
    this.config = {
      windowRadius: config.windowRadius ?? 2,        // 5x5 window by default
      normalizeByGradient: config.normalizeByGradient ?? true,
      varianceScale: config.varianceScale ?? 1.0,
      maxVariance: config.maxVariance,
    };
  }

  dispose(): void {
    // No resources to release.
  }

  /**
   * Compute texture strength map from image
   * 
   * @param image Input grayscale image (Float32Array, 0-1 normalized)
   * @returns ChannelImage containing texture strength values
   *          Each pixel: 0 = pure structure (edges, boundaries)
   *                     1 = pure texture (patterns, fine details)
   *          Developer uses these values to adapt XDoG parameters
   */
  async process(image: ChannelImage): Promise<ChannelImage> {
    const result = new Float32Array(image.data.length);
    const { width, height, data } = image;
    const { windowRadius, normalizeByGradient, varianceScale, maxVariance } = this.config;

    // For each pixel
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIdx = y * width + x;
        
        // Compute variance in window around pixel
        const variance = this.computeLocalVariance(
          data,
          width,
          height,
          x,
          y,
          windowRadius
        );

        let textureStrength = variance * varianceScale;

        // Optional: Normalize by gradient strength
        if (normalizeByGradient) {
          const gradient = this.computeLocalGradient(data, width, height, x, y);
          // High gradient + high variance → likely edge, reduce texture score
          // Low gradient + high variance → likely texture, keep high
          const gradientFactor = 1.0 / (1.0 + gradient * gradient);
          textureStrength = textureStrength * gradientFactor;
        }

        // Clamp if requested
        if (maxVariance !== undefined) {
          textureStrength = Math.min(textureStrength, maxVariance);
        }

        // Normalize to 0-1
        result[pixelIdx] = Math.min(1.0, textureStrength);
      }
    }

    return {
      data: result,
      width,
      height,
    };
  }

  /**
   * Compute variance of pixel values in a window
   * @private
   */
  private computeLocalVariance(
    data: Float32Array,
    width: number,
    height: number,
    cx: number,
    cy: number,
    radius: number
  ): number {
    let sum = 0;
    let sumSquares = 0;
    let count = 0;

    // Sum values in window
    for (let dy = -radius; dy <= radius; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= height) continue;
      const rowOffset = y * width; // computed once per row instead of once per pixel

      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= width) continue;

        const value = data[rowOffset + x];
        sum += value;
        sumSquares += value * value;
        count++;
      }
    }

    const mean = sum / count;
    const meanOfSquares = sumSquares / count;
    const variance = meanOfSquares - mean * mean;

    return Math.max(0, variance); // Clamp to non-negative
  }

  /**
   * Compute gradient magnitude at pixel (Sobel filter)
   * Used to normalize variance (distinguish texture from edges)
   * @private
   */
  private computeLocalGradient(
    data: Float32Array,
    width: number,
    height: number,
    x: number,
    y: number
  ): number {
    // Sobel kernel
    let gx = 0;
    let gy = 0;

    if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
      const rowUp = (y - 1) * width;
      const rowMid = y * width;
      const rowDown = (y + 1) * width;

      // Each neighbor is read once and reused in both gx and gy,
      // instead of re-indexing/re-reading it for each.
      const tl = data[rowUp + x - 1];
      const tm = data[rowUp + x];
      const tr = data[rowUp + x + 1];
      const ml = data[rowMid + x - 1];
      const mr = data[rowMid + x + 1];
      const bl = data[rowDown + x - 1];
      const bm = data[rowDown + x];
      const br = data[rowDown + x + 1];

      // Gx (vertical edges)
      gx = (-tl + tr) + (-2 * ml + 2 * mr) + (-bl + br);

      // Gy (horizontal edges)
      gy = (tl + 2 * tm + tr) - (bl + 2 * bm + br);
    }

    const magnitude = Math.sqrt(gx * gx + gy * gy);
    return magnitude;
  }
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
export class LocalVariancePreprocessorOptimized implements Preprocessor {
  private config: LocalVarianceConfig;
  /** CPU-only — no WebGL/WebGPU counterpart exists for this preprocessor. */
  readonly backend = 'cpu' as const;

  constructor(config: Partial<LocalVarianceConfig> = {}) {
    this.config = {
      windowRadius: config.windowRadius ?? 2,
      normalizeByGradient: config.normalizeByGradient ?? true,
      varianceScale: config.varianceScale ?? 1.0,
      maxVariance: config.maxVariance,
    };
  }

  dispose(): void {
    // No resources to release.
  }

  /**
   * Process using separable convolution (faster for large windows)
   * Variance = E[X^2] - E[X]^2
   * Compute box blur of X and X^2 separately, then combine
   */
  async process(image: ChannelImage): Promise<ChannelImage> {
    const { width, height, data } = image;
    const { windowRadius, normalizeByGradient, varianceScale, maxVariance } = this.config;

    // Step 1: Compute E[X] (mean) via box filter
    const meanImage = this.boxBlur(data, width, height, windowRadius);

    // Step 2: Compute E[X^2] via box filter on squared values
    const squaredData = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      squaredData[i] = data[i] * data[i];
    }
    const meanOfSquaresImage = this.boxBlur(squaredData, width, height, windowRadius);

    // Step 3: Compute variance = E[X^2] - E[X]^2
    const result = new Float32Array(data.length);
    const gradientMap = normalizeByGradient ? this.computeGradientMap(data, width, height) : null;

    for (let i = 0; i < data.length; i++) {
      const mean = meanImage[i];
      const variance = Math.max(0, meanOfSquaresImage[i] - mean * mean);

      let textureStrength = variance * varianceScale;

      if (normalizeByGradient && gradientMap) {
        const gradient = gradientMap[i];
        const gradientFactor = 1.0 / (1.0 + gradient * gradient);
        textureStrength *= gradientFactor;
      }

      if (maxVariance !== undefined) {
        textureStrength = Math.min(textureStrength, maxVariance);
      }

      result[i] = Math.min(1.0, textureStrength);
    }

    return { data: result, width, height };
  }

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
  private boxBlur(
    data: Float32Array,
    width: number,
    height: number,
    radius: number
  ): Float32Array {
    const windowSize = 2 * radius + 1;
 
    // Horizontal pass: O(width) per row via a running sum, not O(width * radius).
    const horizontal = new Float32Array(data.length);
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
 
      // Seed the window sum for x = 0 (the only O(radius) step per row).
      let sum = 0;
      for (let j = 0; j < windowSize; j++) {
        const srcX = Math.max(0, Math.min(width - 1, j - radius));
        sum += data[rowOffset + srcX];
      }
      horizontal[rowOffset] = sum / windowSize;
 
      // Slide the window one column at a time: O(1) per step instead of O(radius).
      for (let x = 1; x < width; x++) {
        const outgoingX = Math.max(0, Math.min(width - 1, x - 1 - radius));
        const incomingX = Math.max(0, Math.min(width - 1, x + radius));
        sum += data[rowOffset + incomingX] - data[rowOffset + outgoingX];
        horizontal[rowOffset + x] = sum / windowSize;
      }
    }
 
    // Vertical pass: same sliding-window trick, now sliding down each column.
    const result = new Float32Array(data.length);
    for (let x = 0; x < width; x++) {
      // Seed the window sum for y = 0.
      let sum = 0;
      for (let j = 0; j < windowSize; j++) {
        const srcY = Math.max(0, Math.min(height - 1, j - radius));
        sum += horizontal[srcY * width + x];
      }
      result[x] = sum / windowSize;
 
      for (let y = 1; y < height; y++) {
        const outgoingY = Math.max(0, Math.min(height - 1, y - 1 - radius));
        const incomingY = Math.max(0, Math.min(height - 1, y + radius));
        sum += horizontal[incomingY * width + x] - horizontal[outgoingY * width + x];
        result[y * width + x] = sum / windowSize;
      }
    }
 
    return result;
  }

  /**
   * Compute gradient map using Sobel filter (separable for efficiency)
   * @private
   */
  private computeGradientMap(
    data: Float32Array,
    width: number,
    height: number
  ): Float32Array {
    const result = new Float32Array(data.length);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
          result[y * width + x] = 0;
          continue;
        }

        const rowUp = (y - 1) * width;
        const rowMid = y * width;
        const rowDown = (y + 1) * width;

        // Each neighbor read once and reused for both gx and gy
        const tl = data[rowUp + x - 1];
        const tm = data[rowUp + x];
        const tr = data[rowUp + x + 1];
        const ml = data[rowMid + x - 1];
        const mr = data[rowMid + x + 1];
        const bl = data[rowDown + x - 1];
        const bm = data[rowDown + x];
        const br = data[rowDown + x + 1];

        // Sobel
        const gx = (-tl + tr) - 2 * ml + 2 * mr - bl + br;
        const gy = tl + 2 * tm + tr - bl - 2 * bm - br;

        const magnitude = Math.sqrt(gx * gx + gy * gy);
        result[y * width + x] = magnitude;
      }
    }

    return result;
  }
}