/**
 * High-level FDoG implementation
 * 
 * This class provides a convenient wrapper that compose the blur strategies
 * and DoG processor together.
 * 
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including 
 * advanced image stylization" by Winnemöller et al. (2012)
 */

import { 
  DEFAULT_ETF_CONFIG,
  type ChannelImage,
  type FlowField,
} from '../interfaces/base.js';
import { DoGProcessor } from '../processor.js';
import { EdgeTangentFlowComputer } from '../etf/index.js';
import { imageDataToLuminance, luminanceToImageData } from '../utils/index.js';
import { GradientAlignedBlur } from '../blur/gradient-aligned/index.js';
import { FlowGuidedBlur } from '../blur/flow-guided.js';
import { DEFAULT_FDOG_CONFIG, FDOG_STYLE_PRESETS, type DoGImplementation, type FDoGConfig } from '../interfaces/dog.js';

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
    const etfComputer = await EdgeTangentFlowComputer.create();
    const etf = await etfComputer.compute(input, {
      iterations: params.etfIterations ?? DEFAULT_ETF_CONFIG.iterations,
      kernelSize: Math.ceil(params.sigmaC * 2.45) * 2 + 1,
    }, params.sigmaC);

    const gradientBlur = await GradientAlignedBlur.create(etf);
    const processor = new DoGProcessor(gradientBlur, params);

    // Step 4: Get the continuous (pre-threshold) DoG response.
    let sharpened = await processor.processNoThreshold(input);

    const flowBlur = await FlowGuidedBlur.create(etf);

    // Step 5: Flow-aligned smoothing (Sec. 2.6's sigma_m -- part of the
    // FDoG operator itself, replacing plain isotropic sigma). This MUST
    // stay pre-threshold: it's accumulating the continuous oriented-DoG
    // response along the tangent axis, not smoothing a binary result.
    if (params.sigmaM > 0) {
      sharpened = await flowBlur.blur(sharpened, params.sigmaM);
    }

    // Step 6: Threshold exactly once here -- this produces the two-tone
    // result (Fig. 6/7b in the XDoG paper).
    let result = processor.applyThreshold(sharpened, params.epsilon, params.phi);
    processor.dispose();

    // Step 7: Anti-aliasing (Sec. 4.3) is a SEPARATE, POST-threshold pass:
    // a small LIC along the ETF applied to the already-thresholded/binary
    // image, to soften its step-function edges. Per the paper, sigma_a is
    // typically tiny (0.5-2px) -- this is not a second round of pre-threshold
    // smoothing, and must not be merged with the sigma_m step above.
    if (params.sigmaA > 0) {
      result = await flowBlur.blur(result, params.sigmaA);
    }

    flowBlur.dispose();
    etfComputer.dispose();

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
    etf: FlowField;
    sharpened: ChannelImage;
    thresholded: ChannelImage;
    smoothed: ChannelImage;
  }> {
    const params = { ...this.config, ...overrides };
    
    // Compute ETF
    const etfComputer = await EdgeTangentFlowComputer.create();
    const etf = await etfComputer.compute(input, {
      iterations: DEFAULT_ETF_CONFIG.iterations,
      kernelSize: Math.ceil(params.sigmaC * 2.45) * 2 + 1,
    }, params.sigmaC);
    
    // Create blur strategies
    const gradientBlur = await GradientAlignedBlur.create(etf);
    const processor = new DoGProcessor(gradientBlur, params);
    
    // Continuous (pre-threshold, pre-accumulation) DoG response.
    const rawSharpened = await processor.processNoThreshold(input);

    const flowBlur = await FlowGuidedBlur.create(etf);

    // Sec. 2.6: sigma_m flow-aligned accumulation is part of the FDoG
    // operator itself and must happen on the continuous response, before
    // thresholding.
    const sharpened = params.sigmaM > 0
      ? await flowBlur.blur(rawSharpened, params.sigmaM)
      : rawSharpened;

    // Threshold once -- this is the paper's "two tone result" (Fig. 6/7b),
    // computed from the sigma_m-accumulated continuous signal.
    const thresholded = processor.applyThreshold(sharpened, params.epsilon, params.phi);
    processor.dispose();

    // Sec. 4.3: sigma_a anti-aliasing is a separate POST-threshold pass --
    // a small LIC along the ETF applied to the binary/two-tone image to
    // soften its step-function edges. Not another round of pre-threshold
    // smoothing.
    const smoothed = params.sigmaA > 0
      ? await flowBlur.blur(thresholded, params.sigmaA)
      : thresholded;

    flowBlur.dispose();
    etfComputer.dispose();

    const result = smoothed;
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
    etf: FlowField,
    overrides: Partial<FDoGConfig> = {}
  ): Promise<ChannelImage> {
    const params = { ...this.config, ...overrides };
    
    const gradientBlur = await GradientAlignedBlur.create(etf);
    const processor = new DoGProcessor(gradientBlur, params);
    
    // Continuous response -- do not threshold yet.
    let sharpened = await processor.processNoThreshold(input);

    // Sec. 2.6: pre-threshold flow accumulation.
    if (params.sigmaM > 0) {
      const flowBlur = await FlowGuidedBlur.create(etf);
      sharpened = await flowBlur.blur(sharpened, params.sigmaM);
      flowBlur.dispose();
    }

    let result = processor.applyThreshold(sharpened, params.epsilon, params.phi);
    processor.dispose();

    // Sec. 4.3: post-threshold anti-aliasing pass.
    if (params.sigmaA > 0) {
      const aaBlur = await FlowGuidedBlur.create(etf);
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
    etf: FlowField,
    sigmaA?: number
  ): Promise<ChannelImage> {
    const sigma = sigmaA ?? this.config.sigmaA;
    if (sigma <= 0) {
      return { data: new Float32Array(input.data), width: input.width, height: input.height };
    }

    const aaBlur = await FlowGuidedBlur.create(etf);
    const result = aaBlur.blur(input, sigma);
    aaBlur.dispose();
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