import type { ChannelImage } from './interfaces/base.js';
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
 * Equivalent to phi -> inf in SoftThresholdStrategy, and to ThresholdModes.hard
 * in processor.ts, but expressed as a ThresholdStrategy so it can be plugged
 * into DoGConfig.thresholdStrategy (e.g. as ADoG's default, since the paper's
 * screentone output is binarized rather than soft-thresholded).
 */
export declare class HardThresholdStrategy implements ThresholdStrategy {
    threshold(input: ChannelImage, config: ThresholdConfig): ChannelImage;
}
/**
 * Canny-style double-threshold strategy with hysteresis edge linking.
 *
 * Classifies each pixel against a high and low bound derived from `epsilon`
 * (`epsilon + highOffset` and `epsilon - highOffset`... see note below) into
 * strong edge, weak edge, and background tiers then promotes weak
 * edges to strong ones if they are 8-connected to a strong edge via flood fill.
 * This suppresses isolated noise pixels while preserving continuous edge lines
 * that dip briefly below the main threshold, which a single global threshold
 * (e.g. HardThresholdStrategy) cannot do.
 *
 * Note: `phi` from ThresholdConfig is unused by this strategy. Sharpness of
 * the strong/weak/background split is controlled entirely by `highOffset` and
 * `lowOffset`, not by a tanh steepness parameter.
 */
export declare class HysteresisThresholdStrategy implements ThresholdStrategy {
    private readonly highOffset;
    private readonly lowOffset;
    /**
     * @param highOffset - Amount added to `epsilon` to form the high (strong-edge)
     *   bound (default: 0.2). Pixels at or above `epsilon + highOffset` are
     *   immediately classified as strong edges (seeds for flood fill).
     * @param lowOffset - Amount subtracted from `epsilon` to form the low
     *   (weak-edge) bound (default: 0.2). Pixels at or above `epsilon - lowOffset`
     *   but below the high bound are classified as weak edges, which only survive
     *   in the output if connected to a strong edge.
     */
    constructor(highOffset?: number, lowOffset?: number);
    threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage;
    private floodFill;
}
//# sourceMappingURL=threshold.d.ts.map