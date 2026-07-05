import { ChannelImage } from "./types.js";
/**
 * Thresholding strategy interface
 * Allows different thresholding approaches to be plugged in
 */
export interface ThresholdStrategy {
    /**
     * Apply thresholding to a sharpened image
     * @param sharpened The sharpened DoG image
     * @param config Configuration containing epsilon, phi, and other threshold parameters
     * @returns Thresholded output image
     */
    threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage;
}
/**
 * Configuration for thresholding operations
 */
export interface ThresholdConfig {
    epsilon: number;
    phi: number;
    epsilonHigh?: number;
    epsilonLow?: number;
    localContrastRadius?: number;
    bilateralRadius?: number;
    bilateralSigmaIntensity?: number;
}
/**
 * Original soft threshold strategy (default)
 * Uses: T_ε,φ(u) = 1 + tanh(φ · (u - ε))
 */
export declare class SoftThresholdStrategy implements ThresholdStrategy {
    threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage;
}
/**
 * Adaptive threshold strategy
 * Spatially-varying threshold: ε(x,y) = ε_base + LocalContrast(x,y)
 * Reduces artifacts in low-contrast regions
 */
export declare class AdaptiveThresholdStrategy implements ThresholdStrategy {
    threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage;
    /**
     * Compute local contrast (standard deviation) in a neighborhood
     */
    private computeLocalContrast;
}
/**
 * Bilateral soft threshold strategy
 * Considers neighborhood similarity to prevent isolated pixel artifacts
 * and improve edge connectivity
 */
export declare class BilateralThresholdStrategy implements ThresholdStrategy {
    threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage;
    /**
     * Apply bilateral filtering to reduce noise while preserving edges
     */
    private bilateralFilter;
}
/**
 * Hysteresis threshold strategy (from Canny edge detection)
 * Uses two thresholds to produce connected edge traces:
 * - Strong edges (above epsilonHigh) are always kept
 * - Weak edges (between epsilonLow and epsilonHigh) are kept only if connected to strong edges
 * - Values below epsilonLow are discarded
 */
export declare class HysteresisThresholdStrategy implements ThresholdStrategy {
    threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage;
    /**
     * Flood fill to connect weak edges to strong edges
     */
    private floodFill;
}
//# sourceMappingURL=threshold.d.ts.map