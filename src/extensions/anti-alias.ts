import { FlowGuidedBlur } from '../blur/index.js';
import type { FlowField, ChannelImage } from '../interfaces/base.js';
import type { ExtensionStrategy } from './base.js';

/**
 * Anti-aliasing configuration
 * 
 * From Section 4.3: "Since many of the examples in this paper use the ETF 
 * field to compute coherent edges, we can easily re-use the ETF to apply 
 * a very small line integral convolution along the field"
 */
export interface AntiAliasingConfig {
  /** 
   * Integration sigma along the flow direction (default: 1.0)
   * - 0.5-2 pixels: Standard anti-aliasing
   * - >2: Stylistic smoothing effect
   */
  sigma: number;
  
  /**
   * Step size for LIC sampling (default: 0.5)
   */
  stepSize: number;
}

const DEFAULT_AA_CONFIG: AntiAliasingConfig = {
  sigma: 1.0,
  stepSize: 0.5,
};

/**
 * Anti-Aliasing Strategy
 * 
 * Applies line integral convolution along the edge tangent flow
 * to produce image-coherent and visually pleasing anti-aliasing.
 * 
 * @example
 * ```typescript
 * const fdog = new FDoG({ ... });
 * const result = await fdog.processDetailed(input);
 * 
 * const aa = new AntiAliasingStrategy();
 * const smoothed = await aa.apply({
 *   image: result.result,
 *   etf: result.etf
 * }, { sigma: 1.5 });
 * ```
 */
export class AntiAliasingStrategy implements ExtensionStrategy<
  AntiAliasingConfig,
  { image: ChannelImage; etf: FlowField },
  ChannelImage
> {
  private config: AntiAliasingConfig;
  
  constructor(config: Partial<AntiAliasingConfig> = {}) {
    this.config = { ...DEFAULT_AA_CONFIG, ...config };
  }
  
  async apply(
    input: { image: ChannelImage; etf: FlowField },
    configOverride?: Partial<AntiAliasingConfig>
  ): Promise<ChannelImage> {
    const cfg = { ...this.config, ...configOverride };
    const { image, etf } = input;
    
    if (cfg.sigma <= 0) {
      return { data: new Float32Array(image.data), width: image.width, height: image.height };
    }
    
    const flowBlur = await FlowGuidedBlur.create(etf, { stepSize: cfg.stepSize });
    const result = flowBlur.blur(image, cfg.sigma);
    flowBlur.dispose();
    return result;
  }
  
  /**
   * Create anti-aliasing with preset intensity
   */
  static withPreset(preset: 'subtle' | 'standard' | 'stylistic'): AntiAliasingStrategy {
    const presets: Record<string, AntiAliasingConfig> = {
      subtle: { sigma: 0.5, stepSize: 0.5 },
      standard: { sigma: 1.0, stepSize: 0.5 },
      stylistic: { sigma: 3.0, stepSize: 0.5 },
    };
    return new AntiAliasingStrategy(presets[preset]);
  }
}
