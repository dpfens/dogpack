import type { ChannelImage, Preprocessor } from '../types.js';
/**
 * Edge-preserving smoothing filter. Standalone preprocessing utility —
 * not part of ThresholdStrategy. Compose manually:
 *
 *   const sharpened = await dog.processNoThreshold(input);
 *   const smoothed = new BilateralFilter(radius, sigmaIntensity).process(sharpened);
 *   const result = new SoftThresholdStrategy().threshold(smoothed, { epsilon, phi });
 */
export declare class BilateralFilter implements Preprocessor {
    private radius;
    private sigmaIntensity;
    constructor(radius?: number, sigmaIntensity?: number);
    process(input: ChannelImage): ChannelImage;
}
//# sourceMappingURL=bilateral-filter.d.ts.map