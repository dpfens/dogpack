import type { ChannelImage } from '../types.js';
/**
 * Edge-preserving smoothing filter. Standalone preprocessing utility —
 * not part of ThresholdStrategy. Compose manually:
 *
 *   const sharpened = await dog.processNoThreshold(input);
 *   const smoothed = bilateralFilter(sharpened, radius, sigmaIntensity);
 *   const result = new SoftThresholdStrategy().threshold(smoothed, { epsilon, phi });
 */
export declare function bilateralFilter(image: ChannelImage, radius?: number, sigmaIntensity?: number): ChannelImage;
//# sourceMappingURL=bilateral-filter.d.ts.map