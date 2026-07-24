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
import { createChannelImage, getPixel } from '../../utils/image.js';
import { generateGaussianKernel } from '../../utils/math.js';


const DEFAULT_BILATERAL_CONFIG: BilateralFilterConfig = {
  sigmaSpatial: 3,
  sigmaRange: 0.1,
  radiusMultiplier: 2,
};

const DEFAULT_MEDIAN_CONFIG: MedianFilterConfig = {
  radius: 2,
};


const DEFAULT_KUWAHARA_CONFIG: KuwaharaFilterConfig = {
  radius: 3,
};

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
export class BilateralFilter extends BaseCPUStrategy implements Preprocessor {
  private readonly config: BilateralFilterConfig;

  constructor(config: Partial<BilateralFilterConfig> = {}) {
    super();
    this.config = { ...DEFAULT_BILATERAL_CONFIG, ...config };
  }

  async process(input: ChannelImage): Promise<ChannelImage> {
    const cfg = this.config;
    const { width, height } = input;
    const output = createChannelImage(width, height);

    const radius = Math.ceil(cfg.sigmaSpatial * (cfg.radiusMultiplier ?? 2));
    const sigmaSpatial2 = 2 * cfg.sigmaSpatial * cfg.sigmaSpatial;
    const sigmaRange2 = 2 * cfg.sigmaRange * cfg.sigmaRange;

    // Precompute spatial weights
    const spatialWeights: number[] = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const dist2 = dx * dx + dy * dy;
        spatialWeights.push(Math.exp(-dist2 / sigmaSpatial2));
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const centerValue = getPixel(input, x, y);

        let sum = 0;
        let weightSum = 0;
        let idx = 0;

        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            const neighborValue = getPixel(input, nx, ny);

            // Range weight based on intensity difference
            const intensityDiff = neighborValue - centerValue;
            const rangeWeight = Math.exp(-(intensityDiff * intensityDiff) / sigmaRange2);

            // Combined weight
            const weight = spatialWeights[idx] * rangeWeight;

            sum += neighborValue * weight;
            weightSum += weight;
            idx++;
          }
        }

        output.data[y * width + x] = weightSum > 0 ? sum / weightSum : centerValue;
      }
    }

    return output;
  }
}

/**
 * Median Filter
 * 
 * Replaces each pixel with the median of its neighborhood.
 * Excellent for removing salt-and-pepper noise and small texture details.
 */
export class MedianFilter extends BaseCPUStrategy implements Preprocessor {
  private readonly config: MedianFilterConfig;

  constructor(config: Partial<MedianFilterConfig> = {}) {
    super();
    this.config = { ...DEFAULT_MEDIAN_CONFIG, ...config };
  }

  async process(input: ChannelImage): Promise<ChannelImage> {
    const { width, height } = input;
    const output = createChannelImage(width, height);

    const radius = this.config.radius;
    const kernelSize = (2 * radius + 1) * (2 * radius + 1);
    const values: number[] = new Array(kernelSize);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let idx = 0;

        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            values[idx++] = getPixel(input, x + dx, y + dy);
          }
        }

        // Sort and take median
        values.sort((a, b) => a - b);
        output.data[y * width + x] = values[Math.floor(kernelSize / 2)];
      }
    }

    return output;
  }
}

/**
 * Kuwahara Filter
 * 
 * Artistic smoothing filter that creates a painterly effect.
 * Divides the neighborhood into 4 quadrants, finds the one with
 * lowest variance, and uses its mean. Creates flat regions with
 * preserved edges - great for a more stylized look.
 */
export class KuwaharaFilter extends BaseCPUStrategy implements Preprocessor {
  private readonly config: KuwaharaFilterConfig;

  constructor(config: Partial<KuwaharaFilterConfig> = {}) {
    super();
    this.config = { ...DEFAULT_KUWAHARA_CONFIG, ...config };
  }

  async process(input: ChannelImage): Promise<ChannelImage> {
    const { width, height } = input;
    const output = createChannelImage(width, height);

    const r = this.config.radius;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Four quadrants: top-left, top-right, bottom-left, bottom-right
        const quadrants = [
          { startX: -r, endX: 0, startY: -r, endY: 0 },
          { startX: 0, endX: r, startY: -r, endY: 0 },
          { startX: -r, endX: 0, startY: 0, endY: r },
          { startX: 0, endX: r, startY: 0, endY: r },
        ];

        let minVariance = Infinity;
        let bestMean = getPixel(input, x, y);

        for (const q of quadrants) {
          let sum = 0;
          let sumSq = 0;
          let count = 0;

          for (let dy = q.startY; dy <= q.endY; dy++) {
            for (let dx = q.startX; dx <= q.endX; dx++) {
              const val = getPixel(input, x + dx, y + dy);
              sum += val;
              sumSq += val * val;
              count++;
            }
          }

          const mean = sum / count;
          const variance = (sumSq / count) - (mean * mean);

          if (variance < minVariance) {
            minVariance = variance;
            bestMean = mean;
          }
        }

        output.data[y * width + x] = bestMean;
      }
    }

    return output;
  }
}

/**
 * Gaussian Blur
 * 
 * Simple Gaussian smoothing. Less edge-preserving than bilateral,
 * but faster. Good for very noisy images or when used with small sigma.
 */
export class GaussianBlur extends BaseCPUStrategy implements Preprocessor {
  private readonly sigma: number;

  constructor(sigma: number = 1.0) {
    super();
    this.sigma = sigma;
  }

  async process(input: ChannelImage): Promise<ChannelImage> {
    const { width, height } = input;
    const sigma = this.sigma;

    if (sigma < 0.1) {
      return { data: new Float32Array(input.data), width, height };
    }

    const radius = Math.ceil(sigma * 3);
    const kernelSize = radius * 2 + 1;
    const kernel = generateGaussianKernel(sigma, kernelSize);

    // Horizontal pass
    const temp = createChannelImage(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let val = 0;
        for (let k = 0; k < kernelSize; k++) {
          val += getPixel(input, x + k - radius, y) * kernel[k];
        }
        temp.data[y * width + x] = val;
      }
    }

    // Vertical pass
    const output = createChannelImage(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let val = 0;
        for (let k = 0; k < kernelSize; k++) {
          val += getPixel(temp, x, y + k - radius) * kernel[k];
        }
        output.data[y * width + x] = val;
      }
    }

    return output;
  }
}

/**
 * Contrast Enhancement
 * 
 * Stretches the histogram to use the full 0-1 range.
 * Can help make edges more distinct before processing.
 */
export class ContrastEnhancer extends BaseCPUStrategy implements Preprocessor {
  private readonly blackPoint: number;
  private readonly whitePoint: number;

  constructor(blackPoint: number = 0.01, whitePoint: number = 0.99) {
    super();
    this.blackPoint = blackPoint;
    this.whitePoint = whitePoint;
  }

  async process(input: ChannelImage): Promise<ChannelImage> {
    const { width, height, data } = input;
    const output = createChannelImage(width, height);
    const size = width * height;

    // Find histogram percentiles
    const sorted = new Float32Array(data).sort();
    const minVal = sorted[Math.floor(size * this.blackPoint)];
    const maxVal = sorted[Math.floor(size * this.whitePoint)];
    const range = maxVal - minVal;

    if (range < 0.01) {
      return { data: new Float32Array(data), width, height };
    }

    for (let i = 0; i < size; i++) {
      output.data[i] = Math.max(0, Math.min(1, (data[i] - minVal) / range));
    }

    return output;
  }
}

/**
 * Quantize to reduce color levels
 * 
 * Reduces the number of intensity levels, creating a posterized effect.
 * Can help reduce noise by grouping similar intensities together.
 */
export class Quantizer extends BaseCPUStrategy implements Preprocessor {
  private readonly levels: number;

  constructor(levels: number = 8) {
    super();
    this.levels = levels;
  }

  async process(input: ChannelImage): Promise<ChannelImage> {
    const { width, height, data } = input;
    const output = createChannelImage(width, height);
    const size = width * height;

    const step = 1 / (this.levels - 1);

    for (let i = 0; i < size; i++) {
      output.data[i] = Math.round(data[i] / step) * step;
    }

    return output;
  }
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
export class LocalVariancePreprocessor implements Preprocessor {
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


/**
 * Preset preprocessing pipelines for common use cases
 */
export const PreprocessingPresets = {
  /**
   * Light preprocessing - minimal smoothing
   * Good for: Clean studio photos, illustrations
   */
  light: async (input: ChannelImage): Promise<ChannelImage> => {
    return await new BilateralFilter({ sigmaSpatial: 2, sigmaRange: 0.08 }).process(input);
  },

  /**
   * Standard preprocessing - balanced smoothing
   * Good for: Most outdoor photos, portraits
   */
  standard: async (input: ChannelImage): Promise<ChannelImage> => {
    return new BilateralFilter({ sigmaSpatial: 4, sigmaRange: 0.1 }).process(input);
  },

  /**
   * Heavy preprocessing - aggressive noise removal
   * Good for: Very textured images (grass, foliage, fabric)
   */
  heavy: async (input: ChannelImage): Promise<ChannelImage> => {
    let result = await new BilateralFilter({ sigmaSpatial: 5, sigmaRange: 0.12 }).process(input);
    result = await new BilateralFilter({ sigmaSpatial: 3, sigmaRange: 0.1 }).process(result);
    return result;
  },

  /**
   * Artistic preprocessing - painterly smoothing
   * Good for: Stylized/artistic output
   */
  artistic: async (input: ChannelImage): Promise<ChannelImage> => {
    let result = await new KuwaharaFilter({ radius: 4 }).process(input);
    result = await new BilateralFilter({ sigmaSpatial: 2, sigmaRange: 0.08 }).process(result);
    return result;
  },

  /**
   * Photo preprocessing - for photos with grass/nature
   * Good for: Landscape, outdoor scenes
   */
  nature: async (input: ChannelImage): Promise<ChannelImage> => {
    // First pass: aggressive bilateral to smooth texture
    let result = await new BilateralFilter({ sigmaSpatial: 6, sigmaRange: 0.15 }).process(input);
    // Second pass: lighter bilateral to clean up
    result = await new BilateralFilter({ sigmaSpatial: 3, sigmaRange: 0.08 }).process(result);
    return result;
  },
};

/**
 * Convenience class for chaining preprocessing operations
 */
export class PreprocessingPipeline {
  private operations: Preprocessor[] = [];

  /**
   * Add bilateral filter to the pipeline
   */
  bilateral(config?: Partial<BilateralFilterConfig>): this {
    this.operations.push(new BilateralFilter(config));
    return this;
  }

  /**
   * Add median filter to the pipeline
   */
  median(config?: Partial<MedianFilterConfig>): this {
    this.operations.push(new MedianFilter(config));
    return this;
  }

  /**
   * Add Kuwahara filter to the pipeline
   */
  kuwahara(config?: Partial<KuwaharaFilterConfig>): this {
    this.operations.push(new KuwaharaFilter(config));
    return this;
  }

  /**
   * Add Gaussian blur to the pipeline
   */
  gaussian(sigma?: number): this {
    this.operations.push(new GaussianBlur(sigma));
    return this;
  }

  /**
   * Add contrast enhancement to the pipeline
   */
  contrast(blackPoint?: number, whitePoint?: number): this {
    this.operations.push(new ContrastEnhancer(blackPoint, whitePoint));
    return this;
  }

  /**
   * Add quantization to the pipeline
   */
  quantize(levels?: number): this {
    this.operations.push(new Quantizer(levels));
    return this;
  }

  /**
   * Add an arbitrary custom preprocessing strategy to the pipeline
   */
  use(preprocessor: Preprocessor): this {
    this.operations.push(preprocessor);
    return this;
  }

  /**
   * Apply all operations in sequence
   */
  async apply(input: ChannelImage): Promise<ChannelImage> {
    let result = input;
    for (const op of this.operations) {
      result = await op.process(result);
    }
    return result;
  }

  /**
   * Clear all operations
   */
  clear(): this {
    this.operations = [];
    return this;
  }
}