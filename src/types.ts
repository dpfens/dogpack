/**
 * Core types for XDoG/FDoG/ADoG/HDoG line drawing implementation
 * 
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including 
 * advanced image stylization" by Winnemöller et al. (2012)
 * and: "Gaussian Image Binarization" by Kang & Stamoulis (2021)
 */

// NOTE: HardThresholdStrategy needs to be added to threshold.ts -- see the
// threshold-additions.ts snippet for its implementation. Merge it into your
// existing threshold.ts (it's a sibling of SoftThresholdStrategy) and this
// import will resolve.

/**
 * Simple 2D vector
 */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Single-channel image representation
 * Using a flat Float32Array for performance and future GPU compatibility
 * Values are normalized to 0-1 range
 */
export interface ChannelImage {
  data: Float32Array;
  width: number;
  height: number;
}

/**
 * RGB image representation
 */
export interface RGBImage {
  data: Float32Array; // Interleaved RGB, length = width * height * 3
  width: number;
  height: number;
}

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
  blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;

  dispose(): void;
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
 * Abstract preprocessing strategy interface
 * Implementations provide different image preprocessing/conditioning
 * operations (bilateral filtering, median filtering, Kuwahara filtering,
 * Gaussian blur, contrast enhancement, quantization, etc.) applied to an
 * image before line detection.
 */
export interface Preprocessor {
  /**
   * Apply this preprocessing operation to an image
   * @param input Source image
   * @returns Processed image
   */
  process(input: ChannelImage): ChannelImage;
}

/**
 * Flow field representing edge tangent directions at each pixel
 */
export interface FlowField {
  getTangent(x: number, y: number): Vec2;
  readonly width: number;
  readonly height: number;
}

export interface BilateralFilterConfig {
  /** Spatial sigma - controls the size of the neighborhood (default: 3) */
  sigmaSpatial: number;
  
  /** Range/intensity sigma - controls sensitivity to intensity differences (default: 0.1) */
  sigmaRange: number;
  
  /** Kernel radius multiplier (default: 2, meaning radius = sigmaSpatial * 2) */
  radiusMultiplier?: number;
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
 * Configuration for Edge Tangent Flow computation
 * 
 * The ETF is computed from the smoothed structure tensor of image gradients.
 * See Section 2.6 of the paper.
 */
export interface ETFConfig {
  /** 
   * Number of refinement iterations for the tangent field (default: 3)
   * More iterations increase line coherence but add computation time
   */
  iterations: number;
  
  /** 
   * Kernel size for structure tensor smoothing (default: 5)
   * Paper uses Gaussian smoothing with sampling within 2.45 * σc
   */
  kernelSize: number;
}

/**
 * Default ETF configuration values
 */
export const DEFAULT_ETF_CONFIG: ETFConfig = {
  iterations: 3,
  kernelSize: 5,
};