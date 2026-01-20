/**
 * Preprocessing module for XDoG/FDoG
 * 
 * Provides filters to prepare images before line detection.
 * These help reduce noise and texture while preserving important edges.
 */

import { GrayscaleImage } from './types.js';
import { createGrayscaleImage, getPixel } from './utils.js';

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

const DEFAULT_BILATERAL_CONFIG: BilateralFilterConfig = {
  sigmaSpatial: 3,
  sigmaRange: 0.1,
  radiusMultiplier: 2,
};

/**
 * Configuration for median filter
 */
export interface MedianFilterConfig {
  /** Radius of the filter (default: 2, meaning 5x5 kernel) */
  radius: number;
}

const DEFAULT_MEDIAN_CONFIG: MedianFilterConfig = {
  radius: 2,
};

/**
 * Configuration for Kuwahara filter
 */
export interface KuwaharaFilterConfig {
  /** Radius of the filter (default: 3) */
  radius: number;
}

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
 */
export function bilateralFilter(
  input: GrayscaleImage,
  config: Partial<BilateralFilterConfig> = {}
): GrayscaleImage {
  const cfg = { ...DEFAULT_BILATERAL_CONFIG, ...config };
  const { width, height } = input;
  const output = createGrayscaleImage(width, height);
  
  const radius = Math.ceil(cfg.sigmaSpatial * cfg.radiusMultiplier);
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

/**
 * Median Filter
 * 
 * Replaces each pixel with the median of its neighborhood.
 * Excellent for removing salt-and-pepper noise and small texture details.
 */
export function medianFilter(
  input: GrayscaleImage,
  config: Partial<MedianFilterConfig> = {}
): GrayscaleImage {
  const cfg = { ...DEFAULT_MEDIAN_CONFIG, ...config };
  const { width, height } = input;
  const output = createGrayscaleImage(width, height);
  
  const radius = cfg.radius;
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

/**
 * Kuwahara Filter
 * 
 * Artistic smoothing filter that creates a painterly effect.
 * Divides the neighborhood into 4 quadrants, finds the one with
 * lowest variance, and uses its mean. Creates flat regions with
 * preserved edges - great for a more stylized look.
 */
export function kuwaharaFilter(
  input: GrayscaleImage,
  config: Partial<KuwaharaFilterConfig> = {}
): GrayscaleImage {
  const cfg = { ...DEFAULT_KUWAHARA_CONFIG, ...config };
  const { width, height } = input;
  const output = createGrayscaleImage(width, height);
  
  const r = cfg.radius;
  
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

/**
 * Gaussian Blur
 * 
 * Simple Gaussian smoothing. Less edge-preserving than bilateral,
 * but faster. Good for very noisy images or when used with small sigma.
 */
export function gaussianBlur(
  input: GrayscaleImage,
  sigma: number = 1.0
): GrayscaleImage {
  const { width, height } = input;
  
  if (sigma < 0.1) {
    return { data: new Float32Array(input.data), width, height };
  }
  
  const radius = Math.ceil(sigma * 3);
  const kernelSize = radius * 2 + 1;
  const kernel = new Float32Array(kernelSize);
  const sigma2 = 2 * sigma * sigma;
  
  let sum = 0;
  for (let i = 0; i < kernelSize; i++) {
    const x = i - radius;
    kernel[i] = Math.exp(-(x * x) / sigma2);
    sum += kernel[i];
  }
  for (let i = 0; i < kernelSize; i++) {
    kernel[i] /= sum;
  }
  
  // Horizontal pass
  const temp = createGrayscaleImage(width, height);
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
  const output = createGrayscaleImage(width, height);
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

/**
 * Contrast Enhancement
 * 
 * Stretches the histogram to use the full 0-1 range.
 * Can help make edges more distinct before processing.
 */
export function enhanceContrast(
  input: GrayscaleImage,
  blackPoint: number = 0.01,
  whitePoint: number = 0.99
): GrayscaleImage {
  const { width, height, data } = input;
  const output = createGrayscaleImage(width, height);
  const size = width * height;
  
  // Find histogram percentiles
  const sorted = new Float32Array(data).sort();
  const minVal = sorted[Math.floor(size * blackPoint)];
  const maxVal = sorted[Math.floor(size * whitePoint)];
  const range = maxVal - minVal;
  
  if (range < 0.01) {
    return { data: new Float32Array(data), width, height };
  }
  
  for (let i = 0; i < size; i++) {
    output.data[i] = Math.max(0, Math.min(1, (data[i] - minVal) / range));
  }
  
  return output;
}

/**
 * Quantize to reduce color levels
 * 
 * Reduces the number of intensity levels, creating a posterized effect.
 * Can help reduce noise by grouping similar intensities together.
 */
export function quantize(
  input: GrayscaleImage,
  levels: number = 8
): GrayscaleImage {
  const { width, height, data } = input;
  const output = createGrayscaleImage(width, height);
  const size = width * height;
  
  const step = 1 / (levels - 1);
  
  for (let i = 0; i < size; i++) {
    output.data[i] = Math.round(data[i] / step) * step;
  }
  
  return output;
}

/**
 * Preset preprocessing pipelines for common use cases
 */
export const PreprocessingPresets = {
  /**
   * Light preprocessing - minimal smoothing
   * Good for: Clean studio photos, illustrations
   */
  light: (input: GrayscaleImage): GrayscaleImage => {
    return bilateralFilter(input, { sigmaSpatial: 2, sigmaRange: 0.08 });
  },
  
  /**
   * Standard preprocessing - balanced smoothing
   * Good for: Most outdoor photos, portraits
   */
  standard: (input: GrayscaleImage): GrayscaleImage => {
    return bilateralFilter(input, { sigmaSpatial: 4, sigmaRange: 0.1 });
  },
  
  /**
   * Heavy preprocessing - aggressive noise removal
   * Good for: Very textured images (grass, foliage, fabric)
   */
  heavy: (input: GrayscaleImage): GrayscaleImage => {
    let result = bilateralFilter(input, { sigmaSpatial: 5, sigmaRange: 0.12 });
    result = bilateralFilter(result, { sigmaSpatial: 3, sigmaRange: 0.1 });
    return result;
  },
  
  /**
   * Artistic preprocessing - painterly smoothing
   * Good for: Stylized/artistic output
   */
  artistic: (input: GrayscaleImage): GrayscaleImage => {
    let result = kuwaharaFilter(input, { radius: 4 });
    result = bilateralFilter(result, { sigmaSpatial: 2, sigmaRange: 0.08 });
    return result;
  },
  
  /**
   * Photo preprocessing - for photos with grass/nature
   * Good for: Landscape, outdoor scenes
   */
  nature: (input: GrayscaleImage): GrayscaleImage => {
    // First pass: aggressive bilateral to smooth texture
    let result = bilateralFilter(input, { sigmaSpatial: 6, sigmaRange: 0.15 });
    // Second pass: lighter bilateral to clean up
    result = bilateralFilter(result, { sigmaSpatial: 3, sigmaRange: 0.08 });
    return result;
  },
};

/**
 * Convenience class for chaining preprocessing operations
 */
export class Preprocessor {
  private operations: Array<(img: GrayscaleImage) => GrayscaleImage> = [];
  
  /**
   * Add bilateral filter to the pipeline
   */
  bilateral(config?: Partial<BilateralFilterConfig>): this {
    this.operations.push(img => bilateralFilter(img, config));
    return this;
  }
  
  /**
   * Add median filter to the pipeline
   */
  median(config?: Partial<MedianFilterConfig>): this {
    this.operations.push(img => medianFilter(img, config));
    return this;
  }
  
  /**
   * Add Kuwahara filter to the pipeline
   */
  kuwahara(config?: Partial<KuwaharaFilterConfig>): this {
    this.operations.push(img => kuwaharaFilter(img, config));
    return this;
  }
  
  /**
   * Add Gaussian blur to the pipeline
   */
  gaussian(sigma?: number): this {
    this.operations.push(img => gaussianBlur(img, sigma));
    return this;
  }
  
  /**
   * Add contrast enhancement to the pipeline
   */
  contrast(blackPoint?: number, whitePoint?: number): this {
    this.operations.push(img => enhanceContrast(img, blackPoint, whitePoint));
    return this;
  }
  
  /**
   * Add quantization to the pipeline
   */
  quantize(levels?: number): this {
    this.operations.push(img => quantize(img, levels));
    return this;
  }
  
  /**
   * Apply all operations in sequence
   */
  apply(input: GrayscaleImage): GrayscaleImage {
    let result = input;
    for (const op of this.operations) {
      result = op(result);
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