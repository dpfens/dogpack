/**
 * Core types for XDoG/FDoG line drawing implementation
 */

/**
 * Simple 2D vector
 */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Grayscale image representation
 * Using a flat Float32Array for performance and future GPU compatibility
 */
export interface GrayscaleImage {
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
 * Flow field representing edge tangent directions at each pixel
 */
export interface FlowField {
  getTangent(x: number, y: number): Vec2;
  readonly width: number;
  readonly height: number;
}

/**
 * Configuration for Difference of Gaussians processing
 */
export interface DoGConfig {
  /** Base blur sigma (default: 1.0) */
  sigma: number;
  
  /** Ratio between the two blur sizes (default: 1.6) */
  k: number;
  
  /** Subtraction weight - controls edge sensitivity (default: 0.98) */
  tau: number;
  
  /** Threshold for white vs black transition (default: 0.5) */
  epsilon: number;
  
  /** Sharpness of the soft threshold / tanh steepness (default: 10) */
  phi: number;
}

/**
 * Configuration for Edge Tangent Flow computation
 */
export interface ETFConfig {
  /** Number of refinement iterations (default: 3) */
  iterations: number;
  
  /** Kernel size for structure tensor smoothing (default: 5) */
  kernelSize: number;
}

/**
 * Default DoG configuration values
 */
export const DEFAULT_DOG_CONFIG: DoGConfig = {
  sigma: 1.0,
  k: 1.6,
  tau: 0.98,
  epsilon: 0.5,
  phi: 10.0,
};

/**
 * Default ETF configuration values
 */
export const DEFAULT_ETF_CONFIG: ETFConfig = {
  iterations: 3,
  kernelSize: 5,
};
