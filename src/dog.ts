/**
 * Difference of Gaussians processor
 * 
 * This is the core processor that can be used for both XDoG (with IsotropicBlur)
 * and FDoG (with FlowGuidedBlur).
 * 
 * Implements the reparameterized formulation from Section 2.5 of:
 * "XDoG: An eXtended difference-of-Gaussians compendium including 
 * advanced image stylization" by Winnemöller et al. (2012)
 */

import { GrayscaleImage, DoGConfig, DEFAULT_DOG_CONFIG } from './types.js';
import { BlurStrategy } from './blur.js';
import { createGrayscaleImage } from './utils.js';

/**
 * Difference of Gaussians processor
 * 
 * Uses the reparameterized formulation (Equation 7):
 * S_σ,k,p(x) = G_σ(x) + p · D_σ,k(x) = (1 + p) · G_σ(x) - p · G_kσ(x)
 * 
 * This is equivalent to unsharp masking of the blurred image, which
 * decouples edge sharpening strength (p) from threshold parameters.
 * 
 * The blur strategy can be swapped to get different effects:
 * - IsotropicBlur: Standard XDoG with uniform blur
 * - FlowGuidedBlur: FDoG with edge-coherent blur
 * - GradientAlignedBlur: Blur across edges only
 */
export class DoGProcessor {
  private config: DoGConfig;
  private blurStrategy: BlurStrategy;
  
  constructor(blurStrategy: BlurStrategy, config: Partial<DoGConfig> = {}) {
    this.blurStrategy = blurStrategy;
    this.config = { ...DEFAULT_DOG_CONFIG, ...config };
  }
  
  /**
   * Process an image through the DoG pipeline
   * 
   * Pipeline:
   * 1. Apply two Gaussian blurs with different sigma values
   * 2. Compute sharpened image using Equation 7
   * 3. Apply soft thresholding using Equation 5
   * 
   * @param input Grayscale input image (values in 0-1 range)
   * @param overrides Optional parameter overrides for this call
   * @returns Processed image with edges detected and stylized
   */
  async process(input: GrayscaleImage, overrides: Partial<DoGConfig> = {}): Promise<GrayscaleImage> {
    const params = { ...this.config, ...overrides };
    
    // Step 1: Apply two Gaussian blurs with different sigma values
    // G_σ * I and G_kσ * I
    const blur1 = await this.blurStrategy.blur(input, params.sigma);
    const blur2 = await this.blurStrategy.blur(input, params.sigma * params.k);
    
    // Step 2: Compute sharpened image using Equation 7
    // S = (1 + p) * G_σ * I - p * G_kσ * I
    const sharpened = this.computeSharpening(blur1, blur2, params.p);
    
    // Step 3: Apply soft thresholding using Equation 5
    const output = this.applyThreshold(sharpened, params.epsilon, params.phi);
    
    return output;
  }
  
  /**
   * Process without thresholding - returns the sharpened image
   * Useful for debugging or custom post-processing
   */
  async processNoThreshold(input: GrayscaleImage, overrides: Partial<DoGConfig> = {}): Promise<GrayscaleImage> {
    const params = { ...this.config, ...overrides };
    
    const blur1 = await this.blurStrategy.blur(input, params.sigma);
    const blur2 = await this.blurStrategy.blur(input, params.sigma * params.k);
    
    return this.computeSharpening(blur1, blur2, params.p);
  }
  
  /**
   * Get the raw DoG response (without sharpening or thresholding)
   * Useful for visualization and debugging
   */
  async processRawDoG(input: GrayscaleImage, overrides: Partial<DoGConfig> = {}): Promise<GrayscaleImage> {
    const params = { ...this.config, ...overrides };
    
    const blur1 = await this.blurStrategy.blur(input, params.sigma);
    const blur2 = await this.blurStrategy.blur(input, params.sigma * params.k);
    
    return this.computeDoG(blur1, blur2);
  }
  
  /**
   * Get current configuration
   */
  getConfig(): Readonly<DoGConfig> {
    return { ...this.config };
  }
  
  /**
   * Update configuration
   */
  setConfig(config: Partial<DoGConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * Replace blur strategy
   */
  setBlurStrategy(strategy: BlurStrategy): void {
    this.blurStrategy = strategy;
  }
  
  /**
   * Compute raw Difference of Gaussians: D(x) = G_σ(x) - G_kσ(x)
   * This is the standard DoG without any weighting
   */
  private computeDoG(
    blur1: GrayscaleImage,
    blur2: GrayscaleImage
  ): GrayscaleImage {
    const output = createGrayscaleImage(blur1.width, blur1.height);
    const size = blur1.width * blur1.height;
    
    for (let i = 0; i < size; i++) {
      output.data[i] = blur1.data[i] - blur2.data[i];
    }
    
    return output;
  }
  
  /**
   * Compute sharpened image using Equation 7 from the paper:
   * S_σ,k,p(x) = G_σ(x) + p · D_σ,k(x) = (1 + p) · G_σ(x) - p · G_kσ(x)
   * 
   * This can be understood as unsharp masking of the blurred image.
   * The parameter p controls the edge sharpening strength independently
   * of the threshold parameters.
   * 
   * @param blur1 G_σ * I (smaller blur)
   * @param blur2 G_kσ * I (larger blur)
   * @param p Sharpening strength (p ≈ 20 typical, p ≈ 100 for woodcut)
   */
  private computeSharpening(
    blur1: GrayscaleImage,
    blur2: GrayscaleImage,
    p: number
  ): GrayscaleImage {
    const output = createGrayscaleImage(blur1.width, blur1.height);
    const size = blur1.width * blur1.height;
    
    // S = (1 + p) * blur1 - p * blur2
    // This is equivalent to: blur1 + p * (blur1 - blur2)
    // Which is: blur1 + p * DoG
    const factor1 = 1 + p;
    const factor2 = p;
    
    for (let i = 0; i < size; i++) {
      output.data[i] = factor1 * blur1.data[i] - factor2 * blur2.data[i];
    }
    
    return output;
  }
  
  /**
   * Apply soft thresholding using Equation 5 from the paper:
   * 
   * T_ε,φ(u) = {
   *   1                           if u >= ε
   *   1 + tanh(φ · (u - ε))       otherwise
   * }
   * 
   * This creates the characteristic XDoG stylization:
   * - Values above ε become white (1)
   * - Values below ε get soft-thresholded with tanh
   * - φ controls the sharpness of the transition
   * 
   * @param sharpened Sharpened image from computeSharpening
   * @param epsilon Threshold value (typically around 0.5-0.8 for normalized images)
   * @param phi Threshold sharpness (0.01 = soft, 100 = near step function)
   */
  private applyThreshold(
    sharpened: GrayscaleImage,
    epsilon: number,
    phi: number
  ): GrayscaleImage {
    const output = createGrayscaleImage(sharpened.width, sharpened.height);
    const size = sharpened.width * sharpened.height;
    
    for (let i = 0; i < size; i++) {
      const u = sharpened.data[i];
      
      if (u >= epsilon) {
        output.data[i] = 1.0;
      } else {
        // Soft threshold with tanh
        // This creates a smooth transition to darker values below epsilon
        output.data[i] = 1.0 + Math.tanh(phi * (u - epsilon));
      }
    }
    
    return output;
  }
}

/**
 * Alternative thresholding modes that can be used for different effects
 * These can be applied to the sharpened image manually for custom styles
 */
export const ThresholdModes = {
  /**
   * Hard black and white threshold (step function)
   * Equivalent to φ → ∞ in the soft threshold
   */
  hard: (value: number, epsilon: number): number => {
    return value >= epsilon ? 1.0 : 0.0;
  },
  
  /**
   * Soft threshold (default XDoG style, Equation 5)
   */
  soft: (value: number, epsilon: number, phi: number): number => {
    if (value >= epsilon) return 1.0;
    return 1.0 + Math.tanh(phi * (value - epsilon));
  },
  
  /**
   * Three-tone (white, gray, black) for sketch effect
   * Creates a posterized look with three distinct values
   */
  threeTone: (value: number, epsilon: number, midPoint: number = 0.0): number => {
    if (value >= epsilon) return 1.0;
    if (value >= midPoint) return 0.5;
    return 0.0;
  },
  
  /**
   * Multi-tone quantization
   * Quantizes to n discrete levels
   */
  multiTone: (value: number, levels: number): number => {
    const step = 1.0 / (levels - 1);
    return Math.round(Math.max(0, Math.min(1, value)) / step) * step;
  },
  
  /**
   * Continuous (no thresholding) - useful for seeing raw sharpened output
   * Maps the range to 0-1 for visualization
   */
  continuous: (value: number): number => {
    return Math.max(0, Math.min(1, value * 0.5 + 0.5));
  },
  
  /**
   * Smooth curve approximating three-value quantization
   * Used for Figure 7(c) in the paper
   */
  smoothThreeTone: (value: number, epsilon: number, phi: number): number => {
    // Creates two smooth steps instead of one
    const upper = 1.0 + Math.tanh(phi * (value - epsilon));
    const lower = 0.5 * (1.0 + Math.tanh(phi * (value - epsilon * 0.5)));
    return Math.max(0, Math.min(1, lower * 0.5 + upper * 0.5));
  },
};

/**
 * Apply a custom threshold function to a grayscale image
 */
export function applyCustomThreshold(
  input: GrayscaleImage,
  thresholdFn: (value: number) => number
): GrayscaleImage {
  const output = createGrayscaleImage(input.width, input.height);
  const size = input.width * input.height;
  
  for (let i = 0; i < size; i++) {
    output.data[i] = thresholdFn(input.data[i]);
  }
  
  return output;
}
