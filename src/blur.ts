/**
 * Blur strategies for DoG processing
 */

import { GrayscaleImage, FlowField } from './types.js';
import { createGrayscaleImage, getPixel } from './utils.js';

/**
 * Abstract blur strategy interface
 * Implementations provide different blur algorithms (isotropic, flow-guided, etc.)
 */
export interface BlurStrategy {
  /**
   * Apply blur to an image with the given sigma (synchronous)
   * Note: May throw on GPU implementations that require async
   * @param input Source image
   * @param sigma Blur radius (standard deviation)
   * @returns Blurred image
   */
  blur(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage>;
}

/**
 * Static interface for blur strategy classes
 * Used to check runtime availability before instantiation
 */
export interface BlurStrategyClass {
  /**
   * Check if this blur strategy is supported in the current environment
   * @returns true if the strategy can be used, false otherwise
   */
  isSupported(): boolean;
  
  /**
   * Get a human-readable reason if the strategy is not supported
   * @returns undefined if supported, or a string explaining why it's not
   */
  getUnsupportedReason?(): string | undefined;
}

/**
 * Configuration for isotropic Gaussian blur
 */
export interface IsotropicBlurConfig {
  /** Kernel size multiplier relative to sigma (default: 6, meaning 3σ on each side) */
  kernelSizeMultiplier: number;
}

const DEFAULT_ISOTROPIC_CONFIG: IsotropicBlurConfig = {
  kernelSizeMultiplier: 6,
};

/**
 * Generate 1D Gaussian kernel
 */
function generateGaussianKernel(sigma: number, size: number): Float32Array {
  const kernel = new Float32Array(size);
  const center = Math.floor(size / 2);
  const sigma2 = 2 * sigma * sigma;
  
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - center;
    kernel[i] = Math.exp(-(x * x) / sigma2);
    sum += kernel[i];
  }
  
  // Normalize
  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }
  
  return kernel;
}

/**
 * Standard isotropic Gaussian blur using separable convolution
 * This is the blur used in basic XDoG
 */
export class IsotropicBlur implements BlurStrategy {
  private config: IsotropicBlurConfig;
  
  /**
   * Check if isotropic blur is supported
   * Always returns true as this is a pure JavaScript implementation
   */
  static isSupported(): boolean {
    return true;
  }
  
  /**
   * Get reason if unsupported (always undefined for this implementation)
   */
  static getUnsupportedReason(): string | undefined {
    return undefined;
  }
  
  constructor(config: Partial<IsotropicBlurConfig> = {}) {
    this.config = { ...DEFAULT_ISOTROPIC_CONFIG, ...config };
  }
  
  async blur(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage> {
    if (sigma < 0.1) {
      // For very small sigma, just return a copy
      return {
        data: new Float32Array(input.data),
        width: input.width,
        height: input.height,
      };
    }
    
    // Compute kernel size (odd number)
    const kernelSize = Math.max(3, Math.floor(sigma * this.config.kernelSizeMultiplier) | 1);
    const kernel = generateGaussianKernel(sigma, kernelSize);
    const halfKernel = Math.floor(kernelSize / 2);
    
    // Separable convolution: horizontal pass
    const temp = createGrayscaleImage(input.width, input.height);
    for (let y = 0; y < input.height; y++) {
      for (let x = 0; x < input.width; x++) {
        let sum = 0;
        for (let k = 0; k < kernelSize; k++) {
          const sampleX = x + k - halfKernel;
          sum += getPixel(input, sampleX, y) * kernel[k];
        }
        temp.data[y * input.width + x] = sum;
      }
    }
    
    // Separable convolution: vertical pass
    const output = createGrayscaleImage(input.width, input.height);
    for (let y = 0; y < input.height; y++) {
      for (let x = 0; x < input.width; x++) {
        let sum = 0;
        for (let k = 0; k < kernelSize; k++) {
          const sampleY = y + k - halfKernel;
          sum += getPixel(temp, x, sampleY) * kernel[k];
        }
        output.data[y * input.width + x] = sum;
      }
    }
    
    return output;
  }
}

/**
 * Flow-guided blur using line integral convolution along edge tangents
 * This is the blur used in FDoG for coherent line drawing
 */
export class FlowGuidedBlur implements BlurStrategy {
  /**
   * Check if flow-guided blur is supported
   * Always returns true as this is a pure JavaScript implementation
   */
  static isSupported(): boolean {
    return true;
  }
  
  /**
   * Get reason if unsupported (always undefined for this implementation)
   */
  static getUnsupportedReason(): string | undefined {
    return undefined;
  }
  
  constructor(private flowField: FlowField) {}
  
  async blur(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage> {
    if (sigma < 0.1) {
      return {
        data: new Float32Array(input.data),
        width: input.width,
        height: input.height,
      };
    }
    
    const output = createGrayscaleImage(input.width, input.height);
    
    // Number of samples along the flow line (proportional to sigma)
    const numSamples = Math.max(3, Math.ceil(sigma * 3)) * 2 + 1;
    const halfSamples = Math.floor(numSamples / 2);
    
    // Generate 1D Gaussian weights
    const weights = generateGaussianKernel(sigma, numSamples);
    
    for (let y = 0; y < input.height; y++) {
      for (let x = 0; x < input.width; x++) {
        const value = this.sampleAlongFlow(input, x, y, halfSamples, weights);
        output.data[y * input.width + x] = value;
      }
    }
    
    return output;
  }
  
  /**
   * Sample along the flow direction using line integral convolution
   */
  private sampleAlongFlow(
    input: GrayscaleImage,
    startX: number,
    startY: number,
    halfSamples: number,
    weights: Float32Array
  ): number {
    const numSamples = weights.length;
    let sum = 0;
    let weightSum = 0;
    
    // Sample in positive flow direction
    let px = startX;
    let py = startY;
    for (let i = halfSamples; i < numSamples; i++) {
      const value = this.bilinearSample(input, px, py);
      sum += value * weights[i];
      weightSum += weights[i];
      
      // Step along flow
      const tangent = this.flowField.getTangent(Math.round(px), Math.round(py));
      px += tangent.x;
      py += tangent.y;
    }
    
    // Sample in negative flow direction
    px = startX;
    py = startY;
    for (let i = halfSamples - 1; i >= 0; i--) {
      // Step against flow first
      const tangent = this.flowField.getTangent(Math.round(px), Math.round(py));
      px -= tangent.x;
      py -= tangent.y;
      
      const value = this.bilinearSample(input, px, py);
      sum += value * weights[i];
      weightSum += weights[i];
    }
    
    return weightSum > 0 ? sum / weightSum : 0;
  }
  
  /**
   * Bilinear interpolation for sub-pixel sampling
   */
  private bilinearSample(image: GrayscaleImage, x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    
    const fx = x - x0;
    const fy = y - y0;
    
    const v00 = getPixel(image, x0, y0);
    const v10 = getPixel(image, x1, y0);
    const v01 = getPixel(image, x0, y1);
    const v11 = getPixel(image, x1, y1);
    
    return (
      v00 * (1 - fx) * (1 - fy) +
      v10 * fx * (1 - fy) +
      v01 * (1 - fx) * fy +
      v11 * fx * fy
    );
  }
}
