/**
 * High-level XDoG and FDoG implementations
 * 
 * These classes provide convenient wrappers that compose the blur strategies
 * and DoG processor together.
 * 
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including 
 * advanced image stylization" by Winnemöller et al. (2012)
 */

import { 
  type ChannelImage,
} from '../types.js';
import { DoGProcessor } from '../processor.js';
import { imageDataToLuminance, luminanceToImageData } from '../utils/index.js';
import { IsotropicBlur } from '../blur/isotropic.js';
import { DEFAULT_DOG_CONFIG, STYLE_PRESETS, type DoGConfig, type DoGImplementation, type DoGProcessingResult, type XDoGConfig } from './types.js';

/**
 * XDoG (Extended Difference of Gaussians)
 * 
 * Uses standard isotropic Gaussian blur for edge detection and stylization.
 * Good for general-purpose edge detection and artistic effects.
 * 
 * This implements the reparameterized XDoG from Section 2.5 of the paper,
 * using Equation 7 for the sharpening computation.
 */
export class XDoG implements DoGImplementation {
  private processor: DoGProcessor;
  private config: XDoGConfig;
  
  constructor(config: Partial<XDoGConfig> = {}) {
    const { kernelSizeMultiplier, ...dogConfig } = config;
    
    this.config = { ...DEFAULT_DOG_CONFIG, kernelSizeMultiplier: 6, ...config };

    const blurStrategy = new IsotropicBlur({
      kernelSizeMultiplier: this.config.kernelSizeMultiplier,
    });
    
    this.processor = new DoGProcessor(blurStrategy, dogConfig);
  }

  dispose(): void {
    this.processor.dispose();
  }
  
  /**
   * Create XDoG with a preset style
   */
  static withPreset(presetName: keyof typeof STYLE_PRESETS): XDoG {
    return new XDoG(STYLE_PRESETS[presetName]);
  }
  
  /**
   * Process a grayscale image
   */
  async process(input: ChannelImage, overrides: Partial<DoGConfig> = {}): Promise<ChannelImage> {
    return this.processor.process(input, overrides);
  }
  
  /**
   * Process without thresholding (returns sharpened image)
   */
  async processSharpened(input: ChannelImage, overrides: Partial<DoGConfig> = {}): Promise<ChannelImage> {
    return this.processor.processNoThreshold(input, overrides);
  }
  
  /**
   * Get raw DoG response for visualization
   */
  async processRawDoG(input: ChannelImage, overrides: Partial<DoGConfig> = {}): Promise<ChannelImage> {
    return this.processor.processRawDoG(input, overrides);
  }

  /**
   * Process and return all intermediate results
   * 
   * This is more efficient than calling process(), processSharpened(), and 
   * processRawDoG() separately as it only performs the blur operations once.
   * 
   * Useful for:
   * - Hatching strategies that need the sharpened image
   * - Debugging and visualization
   * - Custom post-processing pipelines
   */
  async processDetailed(input: ChannelImage, overrides: Partial<DoGConfig> = {}): Promise<DoGProcessingResult> {
    return this.processor.processDetailed(input, overrides);
  }
  
  /**
   * Convenience method to process ImageData directly (e.g., from a canvas)
   */
  async processGrayscaleImageData(input: ImageData, overrides: Partial<DoGConfig> = {}): Promise<ImageData> {
    const grayscale = imageDataToLuminance(input);
    const result = await this.process(grayscale, overrides);
    return luminanceToImageData(result);
  }
  
  /**
   * Get current configuration
   */
  getConfig(): Readonly<XDoGConfig> {
    return { ...this.config, ...this.processor.getConfig() };
  }
  
  /**
   * Update configuration
   */
  setConfig(config: Partial<XDoGConfig>): void {
    const { kernelSizeMultiplier, ...dogConfig } = config;
    
    if (kernelSizeMultiplier !== undefined) {
      this.config.kernelSizeMultiplier = kernelSizeMultiplier;
      // Need to recreate blur strategy with new kernel size
      const blurStrategy = new IsotropicBlur({ kernelSizeMultiplier });
      this.processor.setBlurStrategy(blurStrategy);
    }
    
    this.processor.setConfig(dogConfig);
  }
}

/**
 * Convenience function for one-shot XDoG processing
 */
export async function xdog(
  input: ChannelImage,
  config: Partial<XDoGConfig> = {}
): Promise<ChannelImage> {
  const processor = new XDoG(config);
  const result = processor.process(input);
  processor.dispose();
  return result;
}