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
  DEFAULT_ETF_CONFIG,
  type ChannelImage,
} from '../types.js';
import { DoGProcessor } from '../processor.js';
import { EdgeTangentFlow } from '../etf/index.js';
import { imageDataToLuminance, luminanceToImageData } from '../utils/index.js';
import { GradientAlignedBlur } from '../blur/gradient-aligned.js';
import { FlowGuidedBlur } from '../blur/flow-guided.js';
import { DEFAULT_FDOG_CONFIG, FDOG_STYLE_PRESETS, type DoGImplementation, type FDoGConfig } from './types.js';

/**
 * FDoG (Flow-based Difference of Gaussians)
 * 
 * Uses flow-guided blur along edge tangent directions for coherent line drawing.
 * Produces smoother, more artistic results similar to hand-drawn illustrations.
 * 
 * This implements the full FDoG pipeline from Section 2.6:
 * 1. Compute Edge Tangent Flow (ETF) from structure tensor
 * 2. Apply gradient-aligned DoG (across edges)
 * 3. Apply flow-aligned smoothing (along edges)
 * 4. Apply soft thresholding
 * 5. Optional: Apply anti-aliasing LIC pass
 * 
 * Parameters:
 * - σc: Structure tensor smoothing (controls ETF smoothness)
 * - σe: Edge detection sigma (controls edge width)
 * - σm: Flow-aligned smoothing (controls line coherence)
 * - σa: Anti-aliasing sigma (optional post-processing)
 */
export class FDoG implements DoGImplementation {
  private config: FDoGConfig;
  
  constructor(config: Partial<FDoGConfig> = {}) {
    this.config = {
      ...DEFAULT_FDOG_CONFIG,
      ...config,
    };
  }

  dispose(): void {
  }
  
  /**
   * Create FDoG with a preset style
   */
  static withPreset(presetName: keyof typeof FDOG_STYLE_PRESETS): FDoG {
    return new FDoG(FDOG_STYLE_PRESETS[presetName]);
  }
  
  /**
   * Process a grayscale image
   * 
   * Unlike XDoG, FDoG computes a new flow field for each image,
   * so the full pipeline runs fresh each time.
   */
  async process(input: ChannelImage, overrides: Partial<FDoGConfig> = {}): Promise<ChannelImage> {
    const params = { ...this.config, ...overrides };
    
    // Step 1: Compute Edge Tangent Flow
    const etf = EdgeTangentFlow.compute(input, {
      iterations: DEFAULT_ETF_CONFIG.iterations,
      kernelSize: Math.ceil(params.sigmaC * 2.45) * 2 + 1,
    }, params.sigmaC);
    
    const gradientBlur = new GradientAlignedBlur(etf);
    const processor = new DoGProcessor(gradientBlur, params);
    
    // Step 4: Process image (DoG + threshold)
    let result = await processor.process(input);
    processor.dispose();
    const flowBlur = new FlowGuidedBlur(etf);
    
    // Step 5: Flow-aligned smoothing
    if (params.sigmaM > 0) {
      result = await flowBlur.blur(result, params.sigmaM);
    }
    
    // Step 6: Anti-aliasing
    if (params.sigmaA > 0) {
      result = await flowBlur.blur(result, params.sigmaA);
    }
    flowBlur.dispose();
    EdgeTangentFlow.dispose();
    return result;
  }
  
  /**
   * Process with more control over individual stages
   */
  async processDetailed(
    input: ChannelImage, 
    overrides: Partial<FDoGConfig> = {}
  ): Promise<{
    result: ChannelImage;
    etf: EdgeTangentFlow;
    sharpened: ChannelImage;
    thresholded: ChannelImage;
    smoothed: ChannelImage;
  }> {
    const params = { ...this.config, ...overrides };
    
    // Compute ETF
    const etf = EdgeTangentFlow.compute(input, {
      iterations: DEFAULT_ETF_CONFIG.iterations,
      kernelSize: Math.ceil(params.sigmaC * 2.45) * 2 + 1,
    }, params.sigmaC);
    
    // Create blur strategies
    const gradientBlur = new GradientAlignedBlur(etf);
    const processor = new DoGProcessor(gradientBlur, params);
    
    // Get intermediate results
    const [sharpened, thresholded] = await Promise.all([
      processor.processNoThreshold(input),
      processor.process(input)
    ]);
    
    // Flow-aligned smoothing
    let smoothed = thresholded;
    if (params.sigmaM > 0) {
      const flowBlur = new FlowGuidedBlur(etf);
      smoothed = await flowBlur.blur(thresholded, params.sigmaM);
      flowBlur.dispose()
    }
    
    // Anti-aliasing
    let result = smoothed;
    if (params.sigmaA > 0) {
      const flowCls = FlowGuidedBlur;
      const aaBlur = new flowCls(etf);
      result = await aaBlur.blur(smoothed, params.sigmaA);
      aaBlur.dispose();
    }
    EdgeTangentFlow.dispose();
    return { result, etf, sharpened, thresholded, smoothed };
  }
  
  /**
   * Convenience method to process ImageData directly
   */
  async processGrayscaleImageData(input: ImageData, overrides: Partial<FDoGConfig> = {}): Promise<ImageData> {
    const grayscale = imageDataToLuminance(input);
    const result = await this.process(grayscale, overrides);
    return luminanceToImageData(result);
  }
  
  /**
   * Process with a pre-computed ETF
   * 
   * Useful when processing multiple frames of video where the ETF
   * can be computed once and reused, or interpolated between keyframes.
   */
  async processWithETF(
    input: ChannelImage,
    etf: EdgeTangentFlow,
    overrides: Partial<FDoGConfig> = {}
  ): Promise<ChannelImage> {
    const params = { ...this.config, ...overrides };
    
    const gradientBlur = new GradientAlignedBlur(etf);
    const processor = new DoGProcessor(gradientBlur, params);
    
    let result = await processor.process(input);
    processor.dispose();

    const flowCls = FlowGuidedBlur;
    if (params.sigmaM > 0) {
      const flowBlur = new flowCls(etf);
      result = await flowBlur.blur(result, params.sigmaM);
      flowBlur.dispose();
    }
    
    if (params.sigmaA > 0) {
      const aaBlur = new flowCls(etf);
      result = await aaBlur.blur(result, params.sigmaA);
      aaBlur.dispose();
    }
    
    return result;
  }
  
  /**
   * Apply only the anti-aliasing pass to an already-processed image
   */
  async applyAntiAliasing(
    input: ChannelImage,
    etf: EdgeTangentFlow,
    sigmaA?: number
  ): Promise<ChannelImage> {
    const sigma = sigmaA ?? this.config.sigmaA;
    if (sigma <= 0) {
      return { data: new Float32Array(input.data), width: input.width, height: input.height };
    }

    const flowCls = FlowGuidedBlur;
    const aaBlur = new flowCls(etf);
    const result = aaBlur.blur(input, sigma);
    aaBlur.dispose();
    EdgeTangentFlow.dispose();
    return result;
  }
  
  /**
   * Get current configuration
   */
  getConfig(): Readonly<FDoGConfig> {
    return { ...this.config };
  }
  
  /**
   * Update configuration
   */
  setConfig(config: Partial<FDoGConfig>): void {
    this.config = { ...this.config, ...config };
  }
}


/**
 * Convenience function for one-shot FDoG processing
 */
export async function fdog(
  input: ChannelImage,
  config: Partial<FDoGConfig> = {}
): Promise<ChannelImage> {
  const processor = new FDoG(config);
  const result = processor.process(input);
  processor.dispose();
  return result;
}
 