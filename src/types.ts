/**
 * Core types for XDoG/FDoG line drawing implementation
 * 
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including 
 * advanced image stylization" by Winnemöller et al. (2012)
 */

import { SoftThresholdStrategy, ThresholdStrategy } from "./threshold.js";

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
 * Configuration for Difference of Gaussians processing
 * 
 * Uses the reparameterized formulation from Section 2.5 of the paper:
 * S_σ,k,p(x) = G_σ(x) + p · D_σ,k(x) = (1 + p) · G_σ(x) - p · G_kσ(x)
 * 
 * This decouples edge sharpening strength (p) from threshold parameters,
 * making the filter much easier to control.
 */
export interface DoGConfig {
  /** 
   * Base blur sigma for edge detection (default: 1.0)
   * Controls the scale of detected edges - larger values detect coarser edges
   * Paper typically uses 0.4-2.0 for most styles
   */
  sigma: number;
  
  /** 
   * Ratio between the two Gaussian blur sizes (default: 1.6)
   * Paper recommends k = 1.6 as a good engineering trade-off
   * This approximates the Laplacian of Gaussian
   */
  k: number;
  
  /** 
   * Sharpening strength parameter 'p' from Equation 7 (default: 20)
   * Controls the strength of edge emphasis
   * - p ≈ 0: No edge enhancement, just blurred image
   * - p ≈ 20: Strong edges suitable for thresholding (paper's typical value)
   * - p ≈ 100+: Extreme edge emphasis for woodcut style
   * 
   * Note: This replaces the original τ parameter. The relationship is:
   * p = τ / (τ - 1), or equivalently τ = p / (p + 1)
   */
  p: number;
  
  /** 
   * Threshold for white vs black transition (default: 0.5)
   * Values above this become white, values below follow the soft threshold
   * Should be in 0-1 range for normalized images
   * Paper's Appendix A shows values around 0.72-0.88 (normalized from 0-100)
   */
  epsilon: number;
  
  /** 
   * Sharpness of the soft threshold / tanh steepness (default: 10)
   * Controls the transition sharpness between black and white
   * - φ ≈ 0.01: Very soft transitions (pencil shading, pastel)
   * - φ ≈ 1-10: Moderate transitions
   * - φ >> 10: Hard black/white threshold (approaches step function)
   */
  phi: number;

  thresholdStrategy: ThresholdStrategy;
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
 * Extended configuration for Flow-based DoG (FDoG)
 * 
 * FDoG uses three separate sigma parameters as described in Section 2.6:
 */
export interface FDoGConfig extends DoGConfig {
  /**
   * σc: Structure tensor smoothing sigma (default: 2.5)
   * Controls the scale of the edge tangent flow computation
   * - Small values: More noise in flow field, captures fine edges
   * - Large values: Smoother flow, may distort fine features
   */
  sigmaC: number;
  
  /**
   * σe: Edge detection sigma - same as 'sigma' in base DoGConfig
   * Controls the width of gradient-aligned DoG filter
   * Larger values discard more fine details and result in wider edge lines
   */
  // Uses 'sigma' from DoGConfig
  
  /**
   * σm: Flow-aligned smoothing sigma for line integral convolution (default: 3.0)
   * Controls the coherence of edge lines
   * - Small values: Short, potentially disconnected edges
   * - Large values: Long, coherent edges (may introduce noise if >> σc)
   */
  sigmaM: number;
  
  /**
   * σa: Anti-aliasing LIC sigma (default: 1.0)
   * Applied as a post-processing step along the ETF
   * - 0: No anti-aliasing
   * - 0.5-2: Typical anti-aliasing
   * - >2: Stylistic smoothing effect
   */
  sigmaA: number;
}


export interface DoGProcessingResult {
  /** Final thresholded output */
  result: ChannelImage;
  /** Sharpened image before thresholding */
  sharpened: ChannelImage;
  /** Raw DoG response (blur1 - blur2) */
  rawDoG?: ChannelImage;
}

/**
 * Interface for DoG processors (XDoG or FDoG)
 */
export interface DoGImplementation {
  process(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<ChannelImage>;

  /** Process and return all intermediate results (avoids redundant blur operations) */
  processDetailed(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<DoGProcessingResult>;
}

/**
 * Default DoG configuration values
 * Based on paper's recommendations and Appendix A parameter ranges
 */
export const DEFAULT_DOG_CONFIG: DoGConfig = {
  sigma: 1.0,
  k: 1.6,
  p: 20.0,       // Strong edge emphasis suitable for most styles
  epsilon: 0.5,  // Mid-tone threshold (normalized 0-1)
  phi: 10.0,     // Moderately sharp 
  thresholdStrategy: new SoftThresholdStrategy()
};

/**
 * Default ETF configuration values
 */
export const DEFAULT_ETF_CONFIG: ETFConfig = {
  iterations: 3,
  kernelSize: 5,
};

/**
 * Default FDoG configuration values
 * Based on Table A.1 in the paper
 */
export const DEFAULT_FDOG_CONFIG: FDoGConfig = {
  ...DEFAULT_DOG_CONFIG,
  sigmaC: 2.5,   // Structure tensor smoothing
  sigmaM: 4.0,   // Flow-aligned smoothing  
  sigmaA: 1.0,   // Anti-aliasing
};

/**
 * Preset configurations for common styles from the paper
 */
export const STYLE_PRESETS = {
  /**
   * Pencil shading style (Figure 1b, Section 5.2)
   * High-frequency detail resembling graphite on paper
   */
  pencilShading: {
    sigma: 0.4,
    k: 1.6,
    p: 20,
    epsilon: 0.5,
    phi: 0.01,  // Very soft threshold for gradual tones
  } as DoGConfig,
  
  /**
   * Pastel style (Figure 18b, Section 5.2)
   * Intermediate edge width with flow turbulence
   */
  pastel: {
    sigma: 2.0,
    k: 1.6,
    p: 40,
    epsilon: 1.0,  // High threshold (mostly white)
    phi: 0.01,
  } as DoGConfig,
  
  /**
   * Charcoal style (Figure 18c, Section 5.2)
   * Broad strokes from large spatial support
   */
  charcoal: {
    sigma: 7.0,
    k: 1.6,
    p: 70,
    epsilon: 0.8,
    phi: 0.01,
  } as DoGConfig,
  
  /**
   * Thresholding / line art (Section 4.1)
   * Clean black and white edges
   */
  threshold: {
    sigma: 1.4,
    k: 1.6,
    p: 20,
    epsilon: 0.78,
    phi: 100,  // Very sharp threshold (near step function)
  } as DoGConfig,
  
  /**
   * Woodcut style (Section 4.2, Figure 15)
   * Aggressive flow distortion with extreme edge emphasis
   */
  woodcut: {
    sigma: 0.8,
    k: 1.6,
    p: 120,    // Extreme edge emphasis
    epsilon: 0.73,
    phi: 100,  // Hard threshold
  } as DoGConfig,
} as const;

/**
 * Preset FDoG configurations including flow parameters
 */
export const FDOG_STYLE_PRESETS = {
  /**
   * Standard FDoG for coherent line drawing (Figure 2g)
   */
  standard: {
    ...STYLE_PRESETS.threshold,
    sigmaC: 2.28,
    sigmaM: 4.4,
    sigmaA: 1.0,
  } as FDoGConfig,
  
  /**
   * Pastel with flow (Figure 18b)
   */
  pastel: {
    ...STYLE_PRESETS.pastel,
    sigmaC: 0.1,   // Minimal structure tensor smoothing
    sigmaM: 20,    // Large flow smoothing for turbulence
    sigmaA: 7.2,
  } as FDoGConfig,
  
  /**
   * Woodcut with aggressive flow (Figure 15)
   */
  woodcut: {
    ...STYLE_PRESETS.woodcut,
    sigmaC: 5.84,
    sigmaM: 3.2,
    sigmaA: 0.75,
  } as FDoGConfig,
} as const;

/**
 * Convert from the original τ parameterization to the new p parameterization
 * τ = p / (p + 1), so p = τ / (1 - τ)
 */
export function tauToP(tau: number): number {
  if (tau >= 1) {
    return Infinity;
  }
  return tau / (1 - tau);
}

/**
 * Convert from p parameterization back to τ
 * p = τ / (1 - τ), so τ = p / (p + 1)
 */
export function pToTau(p: number): number {
  return p / (p + 1);
}
