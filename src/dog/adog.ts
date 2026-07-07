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
  type BlurStrategy,
} from '../types';
import { createChannelImage, imageDataToLuminance, luminanceToImageData } from '../utils';
import { IsotropicBlur } from '../blur/isotropic';
import { gaussianSample } from '../utils';
import { DEFAULT_ADOG_CONFIG, type ADoGConfig, type ADoGProcessingResult, type DoGConfig, type DoGImplementation } from './types';

/**
 * XDoG configuration combining DoG parameters with isotropic blur options
 */
export interface XDoGConfig extends DoGConfig {
  /** Kernel size multiplier for Gaussian blur (default: 6) */
  kernelSizeMultiplier?: number;
  blurStrategy?: BlurStrategy;
}

export class ADoG implements DoGImplementation {
  private config: ADoGConfig;
  private blurStrategy: IsotropicBlur;
 
  constructor(config: Partial<ADoGConfig> = {}) {
    this.config = { ...DEFAULT_ADOG_CONFIG, kernelSizeMultiplier: 6, ...config };
    this.blurStrategy = new IsotropicBlur({
      kernelSizeMultiplier: this.config.kernelSizeMultiplier,
    });
  }
 
  dispose(): void {
    this.blurStrategy.dispose();
  }
 
  /**
   * Process a grayscale image through the ADoG pipeline.
   * 
   * Note on the DoGImplementation interface: this method's `overrides` is
   * typed against Partial<ADoGConfig> (a superset of DoGConfig), which
   * satisfies DoGImplementation's Partial<DoGConfig> parameter type via
   * TypeScript's bivariant method-parameter checking. A caller holding this
   * instance through the DoGImplementation interface type (rather than the
   * concrete ADoG type) can only type-check overrides for fields that exist
   * on DoGConfig (sigma, k, epsilon, phi, ...) -- tau/s/noiseScaleC are only
   * overridable when the caller has a concrete ADoG reference. No data is
   * lost; this only affects what's type-checkable through the narrower view.
   */
  async process(input: ChannelImage, overrides: Partial<ADoGConfig> = {}): Promise<ChannelImage> {
    const { result } = await this.processDetailed(input, overrides);
    return result;
  }
 
  async processDetailed(input: ChannelImage, overrides: Partial<ADoGConfig> = {}): Promise<ADoGProcessingResult> {
    const params = { ...this.config, ...overrides };
 
    // Step 1 (Eq. 6): tone-adaptive noise injection, applied before blurring.
    // Skipped entirely when noiseScaleC is 0 (noise injection is optional --
    // see Figs. 7 vs 8 in the paper).
    const noisyInput = params.noiseScaleC > 0
      ? this.injectAdaptiveNoise(input, params.noiseScaleC, params.s)
      : input;
 
    // Step 2: two isotropic Gaussian blurs -- sigma = sigmaC, k*sigmaC = sigmaS
    const [blurC, blurS] = await Promise.all([
      this.blurStrategy.blur(noisyInput, params.sigma),
      this.blurStrategy.blur(noisyInput, params.sigma * params.k),
    ]);
 
    // Step 3 (Eq. 5): per-pixel adaptive weight rho(x), computed from the
    // ORIGINAL (pre-noise) input tone -- not from the blurred images.
    const rhoMap = this.computeRhoMap(input, params.tau, params.s);
 
    // Step 4 (Eq. 4): ADoG(x) = G_sigmaC(x) - rho(x) * G_sigmaS(x)
    const sharpened = this.computeWeightedDoG(blurC, blurS, rhoMap);
 
    // Unweighted response (rho == 1 everywhere), i.e. standard DoG --
    // exposed for comparison purposes (Fig. 7(b) in the paper).
    const rawDoG = this.computeUnweightedDoG(blurC, blurS);
 
    // Step 5: binarize (hard threshold by default via config.thresholdStrategy)
    const result = this.config.thresholdStrategy.threshold(sharpened, {
      epsilon: params.epsilon,
      phi: params.phi,
    });
 
    return { result, sharpened, rawDoG, rhoMap, noisyInput };
  }
 
  /**
   * Convenience method to process ImageData directly (e.g., from a canvas),
   * matching XDoG/FDoG's convenience method of the same name.
   */
  async processGrayscaleImageData(input: ImageData, overrides: Partial<ADoGConfig> = {}): Promise<ImageData> {
    const grayscale = imageDataToLuminance(input);
    const result = await this.process(grayscale, overrides);
    return luminanceToImageData(result);
  }
 
  /**
   * Get current configuration
   */
  getConfig(): Readonly<ADoGConfig> {
    return { ...this.config };
  }
 
  /**
   * Update configuration
   */
  setConfig(config: Partial<ADoGConfig>): void {
    if (config.kernelSizeMultiplier !== undefined) {
      this.blurStrategy = new IsotropicBlur({ kernelSizeMultiplier: config.kernelSizeMultiplier });
    }
    this.config = { ...this.config, ...config };
  }
 
  /** Eq. (5): rho(x) = tau + (1 - tau) * (1 - tanh(s * I(x))) */
  private computeRhoMap(input: ChannelImage, tau: number, s: number): ChannelImage {
    const output = createChannelImage(input.width, input.height);
    for (let i = 0; i < input.data.length; i++) {
      output.data[i] = tau + (1 - tau) * (1 - Math.tanh(s * input.data[i]));
    }
    return output;
  }
 
  /** Eq. (6): sigma(x) = c * (1 - tanh(s * I(x))); sampled noise ~ N(0,1) * sigma(x) added to I(x) */
  private injectAdaptiveNoise(input: ChannelImage, c: number, s: number): ChannelImage {
    const output = createChannelImage(input.width, input.height);
    for (let i = 0; i < input.data.length; i++) {
      const sigma = c * (1 - Math.tanh(s * input.data[i]));
      output.data[i] = input.data[i] + sigma * gaussianSample();
    }
    return output;
  }
 
  /** Eq. (3)/(4): ADoG(x) = G_sigmaC(x) - rho(x) * G_sigmaS(x) */
  private computeWeightedDoG(blurC: ChannelImage, blurS: ChannelImage, rho: ChannelImage): ChannelImage {
    const output = createChannelImage(blurC.width, blurC.height);
    for (let i = 0; i < blurC.data.length; i++) {
      output.data[i] = blurC.data[i] - rho.data[i] * blurS.data[i];
    }
    return output;
  }
 
  /** Standard (non-adaptive) DoG: G_sigmaC(x) - G_sigmaS(x), i.e. rho == 1 everywhere */
  private computeUnweightedDoG(blurC: ChannelImage, blurS: ChannelImage): ChannelImage {
    const output = createChannelImage(blurC.width, blurC.height);
    for (let i = 0; i < blurC.data.length; i++) {
      output.data[i] = blurC.data[i] - blurS.data[i];
    }
    return output;
  }
}
 

/**
 * Convenience function for one-shot ADoG processing, matching xdog()/fdog()
 * in dog.ts
 */
export async function adog(input: ChannelImage, config: Partial<ADoGConfig> = {}): Promise<ChannelImage> {
  const processor = new ADoG(config);
  const result = await processor.process(input);
  processor.dispose();
  return result;
}