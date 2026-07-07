import type { ChannelImage } from './types';
export interface ThresholdStrategy {
    threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage;
}
export interface ThresholdConfig {
    epsilon: number | ChannelImage;
    phi: number | ChannelImage;
}
export declare class SoftThresholdStrategy implements ThresholdStrategy {
    threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage;
}
/**
 * Hard black/white threshold (step function).
 * Equivalent to φ → ∞ in SoftThresholdStrategy, and to ThresholdModes.hard
 * in processor.ts, but expressed as a ThresholdStrategy so it can be plugged
 * into DoGConfig.thresholdStrategy (e.g. as ADoG's default, since the paper's
 * screentone output is binarized rather than soft-thresholded).
 */
export declare class HardThresholdStrategy implements ThresholdStrategy {
    threshold(input: ChannelImage, config: ThresholdConfig): ChannelImage;
}
export declare class HysteresisThresholdStrategy implements ThresholdStrategy {
    private readonly highOffset;
    private readonly lowOffset;
    constructor(highOffset?: number, lowOffset?: number);
    threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage;
    private floodFill;
}
//# sourceMappingURL=threshold.d.ts.map