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
import { andCombine } from '../utils/index.js';
import { ADoG } from './adog.js';
import { FDoG } from './fdog.js';
import { DEFAULT_ADOG_CONFIG, DEFAULT_HDOG_CONFIG, type DoGImplementation, type HDoGConfig, type HDoGProcessingResult } from './types.js';


export class HDoG implements DoGImplementation {
  private fdog: FDoG;
  private adogPrimary: ADoG;
  private adogSecondary: ADoG;
 
  constructor(config: Partial<HDoGConfig> = {}) {
    const merged = { ...DEFAULT_HDOG_CONFIG, ...config };
    const primaryConfig = { ...DEFAULT_ADOG_CONFIG, ...merged.adog };
    const secondaryConfig = {
      ...primaryConfig,
      s: primaryConfig.s * merged.adogSecondaryScaleFactor,
    };
 
    this.fdog = new FDoG(merged.fdog);
    this.adogPrimary = new ADoG(primaryConfig);
    this.adogSecondary = new ADoG(secondaryConfig);
  }
 
  dispose(): void {
    this.fdog.dispose();
    this.adogPrimary.dispose();
    this.adogSecondary.dispose();
  }
 
  /**
   * Eq. (9): HDoG = FDoG ∧ ADoG_s ∧ ADoG_s'
   * 
   * Note: HDoG's own configuration (fdog/adog/adogSecondaryScaleFactor) is
   * nested rather than a flat DoGConfig, so per-call overrides aren't
   * exposed here the way XDoG/FDoG/ADoG expose them -- there's no clean way
   * to map a flat Partial<DoGConfig> onto "override the nested fdog config,
   * or the nested adog config, or the scale factor". Configure via the
   * constructor; if you need per-call tuning, consider adding a dedicated
   * method (e.g. processWithConfig(input, HDoGConfig overrides)) rather than
   * overloading `process`.
   */
  async process(input: ChannelImage): Promise<ChannelImage> {
    const [lines, tone1, tone2] = await Promise.all([
      this.fdog.process(input),
      this.adogPrimary.process(input),
      this.adogSecondary.process(input),
    ]);
 
    return andCombine([lines, tone1, tone2]);
  }
 
  async processDetailed(input: ChannelImage): Promise<HDoGProcessingResult> {
    const [fdogDetailed, adog1Detailed, adog2Detailed] = await Promise.all([
      this.fdog.processDetailed(input),
      this.adogPrimary.processDetailed(input),
      this.adogSecondary.processDetailed(input),
    ]);
 
    const result = andCombine([
      fdogDetailed.result,
      adog1Detailed.result,
      adog2Detailed.result,
    ]);
 
    return {
      result,
      sharpened: fdogDetailed.sharpened,
      fdogResult: fdogDetailed.result,
      adogPrimaryResult: adog1Detailed.result,
      adogSecondaryResult: adog2Detailed.result,
    };
  }
}

/**
 * Convenience function for one-shot HDoG processing, matching xdog()/fdog()
 * in dog.ts and adog() in adog.ts
 */
export async function hdog(input: ChannelImage, config: Partial<HDoGConfig> = {}): Promise<ChannelImage> {
  const processor = new HDoG(config);
  const result = await processor.process(input);
  processor.dispose();
  return result;
}
 