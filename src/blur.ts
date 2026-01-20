/**
 * Blur strategies for DoG processing
 * 
 * Provides both isotropic (standard) and anisotropic (flow-guided) blur
 * implementations for use in XDoG and FDoG pipelines.
 */

import { GrayscaleImage, FlowField } from './types.js';
import { createGrayscaleImage, getPixel, getPixelBilinear, generateGaussianKernel, computeKernelSize } from './utils.js';

/**
 * Abstract blur strategy interface
 * Implementations provide different blur algorithms (isotropic, flow-guided, etc.)
 */
export interface BlurStrategy {
  /**
   * Apply blur to an image with the given sigma
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
  /** 
   * Kernel size multiplier relative to sigma (default: 6, meaning 3σ on each side)
   * Paper samples at 2× sigma for flow-aligned, 2.45× for structure tensor
   */
  kernelSizeMultiplier: number;
}

const DEFAULT_ISOTROPIC_CONFIG: IsotropicBlurConfig = {
  kernelSizeMultiplier: 6,
};

/**
 * Configuration for flow-guided blur
 */
export interface FlowGuidedBlurConfig {
  /** 
   * Kernel size multiplier for flow-aligned LIC (default: 6)
   */
  kernelSizeMultiplier: number;
  
  /**
   * Step size for line integral convolution (default: 1.0)
   * Smaller values give smoother integration but cost more
   */
  stepSize: number;
}

const DEFAULT_FLOW_CONFIG: FlowGuidedBlurConfig = {
  kernelSizeMultiplier: 6,
  stepSize: 1.0,
};

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
    const kernelSize = computeKernelSize(sigma, this.config.kernelSizeMultiplier);
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
 * 
 * The blur is computed by integrating pixel values along the flow direction,
 * weighted by a Gaussian kernel. This produces blur that follows edge contours
 * rather than blurring across them.
 */
export class FlowGuidedBlur implements BlurStrategy {
  private config: FlowGuidedBlurConfig;
  
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
  
  constructor(
    private flowField: FlowField,
    config: Partial<FlowGuidedBlurConfig> = {}
  ) {
    this.config = { ...DEFAULT_FLOW_CONFIG, ...config };
  }
  
  /**
   * Update the flow field (e.g., when processing a new image)
   */
  setFlowField(flowField: FlowField): void {
    this.flowField = flowField;
  }
  
  async blur(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage> {
    if (sigma < 0.1) {
      return {
        data: new Float32Array(input.data),
        width: input.width,
        height: input.height,
      };
    }
    
    const output = createGrayscaleImage(input.width, input.height);
    
    // Number of samples along the flow line
    // Paper samples at 2× sigma in each direction
    const halfSamples = Math.ceil(sigma * 2 / this.config.stepSize);
    const numSamples = halfSamples * 2 + 1;
    
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
   * 
   * This follows the tangent field in both directions from the starting point,
   * accumulating weighted samples to produce a blur along the edge direction.
   */
  private sampleAlongFlow(
    input: GrayscaleImage,
    startX: number,
    startY: number,
    halfSamples: number,
    weights: Float32Array
  ): number {
    const numSamples = weights.length;
    const stepSize = this.config.stepSize;
    let sum = 0;
    let weightSum = 0;
    
    // Sample at center (index = halfSamples)
    sum += getPixelBilinear(input, startX, startY) * weights[halfSamples];
    weightSum += weights[halfSamples];
    
    // Sample in positive flow direction
    let px = startX;
    let py = startY;
    for (let i = 1; i <= halfSamples; i++) {
      // Step along flow
      const tangent = this.flowField.getTangent(Math.round(px), Math.round(py));
      px += tangent.x * stepSize;
      py += tangent.y * stepSize;
      
      // Bounds check (with tolerance for interpolation)
      if (px < -0.5 || px > input.width - 0.5 || 
          py < -0.5 || py > input.height - 0.5) {
        break;
      }
      
      const idx = halfSamples + i;
      const value = getPixelBilinear(input, px, py);
      sum += value * weights[idx];
      weightSum += weights[idx];
    }
    
    // Sample in negative flow direction
    px = startX;
    py = startY;
    for (let i = 1; i <= halfSamples; i++) {
      // Step against flow
      const tangent = this.flowField.getTangent(Math.round(px), Math.round(py));
      px -= tangent.x * stepSize;
      py -= tangent.y * stepSize;
      
      // Bounds check
      if (px < -0.5 || px > input.width - 0.5 || 
          py < -0.5 || py > input.height - 0.5) {
        break;
      }
      
      const idx = halfSamples - i;
      const value = getPixelBilinear(input, px, py);
      sum += value * weights[idx];
      weightSum += weights[idx];
    }
    
    return weightSum > 0 ? sum / weightSum : 0;
  }
}

/**
 * Gradient-aligned blur for FDoG
 * 
 * This applies blur perpendicular to the flow direction (across edges).
 * Used for the DoG computation in FDoG, where we want to blur across
 * edges but not along them.
 */
export class GradientAlignedBlur implements BlurStrategy {
  private config: FlowGuidedBlurConfig;
  
  static isSupported(): boolean {
    return true;
  }
  
  static getUnsupportedReason(): string | undefined {
    return undefined;
  }
  
  constructor(
    private flowField: FlowField,
    config: Partial<FlowGuidedBlurConfig> = {}
  ) {
    this.config = { ...DEFAULT_FLOW_CONFIG, ...config };
  }
  
  setFlowField(flowField: FlowField): void {
    this.flowField = flowField;
  }
  
  async blur(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage> {
    if (sigma < 0.1) {
      return {
        data: new Float32Array(input.data),
        width: input.width,
        height: input.height,
      };
    }
    
    const output = createGrayscaleImage(input.width, input.height);
    
    // Number of samples perpendicular to flow
    const halfSamples = Math.ceil(sigma * 2 / this.config.stepSize);
    const numSamples = halfSamples * 2 + 1;
    const weights = generateGaussianKernel(sigma, numSamples);
    
    for (let y = 0; y < input.height; y++) {
      for (let x = 0; x < input.width; x++) {
        const value = this.sampleAcrossFlow(input, x, y, halfSamples, weights);
        output.data[y * input.width + x] = value;
      }
    }
    
    return output;
  }
  
  /**
   * Sample perpendicular to the flow direction
   */
  private sampleAcrossFlow(
    input: GrayscaleImage,
    startX: number,
    startY: number,
    halfSamples: number,
    weights: Float32Array
  ): number {
    const stepSize = this.config.stepSize;
    let sum = 0;
    let weightSum = 0;
    
    // Get perpendicular direction (gradient direction)
    const tangent = this.flowField.getTangent(startX, startY);
    const gradX = -tangent.y;  // Perpendicular: rotate 90 degrees
    const gradY = tangent.x;
    
    // Sample at center
    sum += getPixelBilinear(input, startX, startY) * weights[halfSamples];
    weightSum += weights[halfSamples];
    
    // Sample in positive gradient direction
    for (let i = 1; i <= halfSamples; i++) {
      const px = startX + gradX * stepSize * i;
      const py = startY + gradY * stepSize * i;
      
      if (px < -0.5 || px > input.width - 0.5 || 
          py < -0.5 || py > input.height - 0.5) {
        break;
      }
      
      const idx = halfSamples + i;
      sum += getPixelBilinear(input, px, py) * weights[idx];
      weightSum += weights[idx];
    }
    
    // Sample in negative gradient direction
    for (let i = 1; i <= halfSamples; i++) {
      const px = startX - gradX * stepSize * i;
      const py = startY - gradY * stepSize * i;
      
      if (px < -0.5 || px > input.width - 0.5 || 
          py < -0.5 || py > input.height - 0.5) {
        break;
      }
      
      const idx = halfSamples - i;
      sum += getPixelBilinear(input, px, py) * weights[idx];
      weightSum += weights[idx];
    }
    
    return weightSum > 0 ? sum / weightSum : 0;
  }
}

/**
 * Two-pass FDoG blur: gradient-aligned DoG followed by flow-aligned smoothing
 * 
 * This implements the full FDoG blur strategy as described in Section 2.6:
 * 1. Apply DoG across edges (gradient-aligned)
 * 2. Smooth the result along edges (flow-aligned)
 */
export class FDoGBlur implements BlurStrategy {
  private gradientBlur: GradientAlignedBlur;
  private flowBlur: FlowGuidedBlur;
  private sigmaM: number;
  
  static isSupported(): boolean {
    return true;
  }
  
  static getUnsupportedReason(): string | undefined {
    return undefined;
  }
  
  /**
   * @param flowField Edge tangent flow field
   * @param sigmaM Flow-aligned smoothing sigma (σm from paper)
   * @param config Additional configuration
   */
  constructor(
    flowField: FlowField,
    sigmaM: number,
    config: Partial<FlowGuidedBlurConfig> = {}
  ) {
    this.gradientBlur = new GradientAlignedBlur(flowField, config);
    this.flowBlur = new FlowGuidedBlur(flowField, config);
    this.sigmaM = sigmaM;
  }
  
  setFlowField(flowField: FlowField): void {
    this.gradientBlur.setFlowField(flowField);
    this.flowBlur.setFlowField(flowField);
  }
  
  setSigmaM(sigmaM: number): void {
    this.sigmaM = sigmaM;
  }
  
  /**
   * Apply the two-pass FDoG blur
   * @param input Source image
   * @param sigma Edge detection sigma (σe) - applied perpendicular to edges
   */
  async blur(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage> {
    // Pass 1: Gradient-aligned blur (across edges)
    const gradientBlurred = await this.gradientBlur.blur(input, sigma);
    
    // Pass 2: Flow-aligned blur (along edges)
    const flowBlurred = await this.flowBlur.blur(gradientBlurred, this.sigmaM);
    
    return flowBlurred;
  }
  
  /**
   * Apply only gradient-aligned blur (for DoG computation)
   */
  async blurGradientAligned(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage> {
    return this.gradientBlur.blur(input, sigma);
  }
  
  /**
   * Apply only flow-aligned blur (for post-processing/anti-aliasing)
   */
  async blurFlowAligned(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage> {
    return this.flowBlur.blur(input, sigma);
  }
}
