/**
 * High-level XDoG implementation
 * 
 * This class provides a convenient wrapper that compose the blur strategies
 * and DoG processor together.
 * 
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including 
 * advanced image stylization" by Winnemöller et al. (2012)
 */

import { 
  type BlurStrategy,
  type ChannelImage,
} from '../interfaces/base.js';
import { DoGProcessor } from '../processor.js';
import { imageDataToLuminance, luminanceToImageData } from '../utils/index.js';
import { IsotropicBlur } from '../blur/isotropic.js';
import { DEFAULT_DOG_CONFIG, STYLE_PRESETS, type DoGConfig, type DoGImplementation, type DoGProcessingResult, type XDoGConfig } from '../interfaces/dog.js';

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
  private config: XDoGConfig;
  private dogConfig: Partial<DoGConfig>;
  private blurStrategyPromise: Promise<BlurStrategy>;

  constructor(config: Partial<XDoGConfig> = {}) {
    const { kernelSizeMultiplier, blurStrategy, ...dogConfig } = config;

    this.config = { ...DEFAULT_DOG_CONFIG, kernelSizeMultiplier: 6, ...config };
    this.dogConfig = dogConfig;

    // Not awaited here — just started. Anything that needs the resolved
    // strategy (process*(), dispose()) awaits this promise itself.
    this.blurStrategyPromise = Promise.resolve(
      blurStrategy ??
        IsotropicBlur.create({ kernelSizeMultiplier: this.config.kernelSizeMultiplier }),
    );
  }

  dispose(): void {
    this.blurStrategyPromise.then((strategy) => strategy.dispose()).catch(() => {});
  }
  
  /**
   * Create XDoG with a preset style
   */
  static withPreset(presetName: keyof typeof STYLE_PRESETS): XDoG {
    return new XDoG(STYLE_PRESETS[presetName]);
  }

  private async getProcessor(): Promise<DoGProcessor> {
    const strategy = await this.blurStrategyPromise;
    return new DoGProcessor(strategy, this.dogConfig);
  }
  
  /**
   * Process a grayscale image
   */
  async process(input: ChannelImage, overrides: Partial<DoGConfig> = {}): Promise<ChannelImage> {
    const processor = await this.getProcessor();
    try {
      return await processor.process(input, overrides);
    } finally {
      processor.dispose();
    }
  }
  
  /**
   * Process without thresholding (returns sharpened image)
   */
  async processSharpened(input: ChannelImage, overrides: Partial<DoGConfig> = {}): Promise<ChannelImage> {
    const processor = await this.getProcessor();
    try {
      return await processor.processNoThreshold(input, overrides);
    } finally {
      processor.dispose();
    }
  }
  
  /**
   * Get raw DoG response for visualization
   */
  async processRawDoG(input: ChannelImage, overrides: Partial<DoGConfig> = {}): Promise<ChannelImage> {
    const processor = await this.getProcessor();
    try {
      return await processor.processRawDoG(input, overrides);
    } finally {
      processor.dispose();
    }
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
    const processor = await this.getProcessor();
    try {
      return await processor.processDetailed(input, overrides);
    } finally {
      processor.dispose();
    }
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
   * Get current configuration.
   */
  getConfig(): Readonly<XDoGConfig> {
    return { ...this.config, ...this.dogConfig };
  }
  
  setConfig(config: Partial<XDoGConfig>): void {
    const { kernelSizeMultiplier, blurStrategy, ...dogConfig } = config;

    this.config = { ...this.config, ...config };
    this.dogConfig = { ...this.dogConfig, ...dogConfig };

    if (blurStrategy !== undefined) {
      const oldStrategyPromise = this.blurStrategyPromise;
      this.blurStrategyPromise = Promise.resolve(blurStrategy);
      oldStrategyPromise.then((s) => s.dispose()).catch(() => {});
    } else if (kernelSizeMultiplier !== undefined) {
      const oldStrategyPromise = this.blurStrategyPromise;
      this.blurStrategyPromise = IsotropicBlur.create({ kernelSizeMultiplier });
      oldStrategyPromise.then((s) => s.dispose()).catch(() => {});
    }
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
  const result = await processor.process(input);
  processor.dispose();
  return result;
}