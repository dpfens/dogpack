/**
 * High-level FDoG implementation
 *
 * This class provides a convenient wrapper that compose the blur strategies
 * and DoG processor together.
 *
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 */
import { type ChannelImage } from '../types.js';
import { EdgeTangentFlow } from '../etf/index.js';
import { FDOG_STYLE_PRESETS, type DoGImplementation, type FDoGConfig } from './types.js';
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
export declare class FDoG implements DoGImplementation {
    private config;
    constructor(config?: Partial<FDoGConfig>);
    dispose(): void;
    /**
     * Create FDoG with a preset style
     */
    static withPreset(presetName: keyof typeof FDOG_STYLE_PRESETS): FDoG;
    /**
     * Process a grayscale image
     *
     * Unlike XDoG, FDoG computes a new flow field for each image,
     * so the full pipeline runs fresh each time.
     */
    process(input: ChannelImage, overrides?: Partial<FDoGConfig>): Promise<ChannelImage>;
    /**
     * Process with more control over individual stages
     */
    processDetailed(input: ChannelImage, overrides?: Partial<FDoGConfig>): Promise<{
        result: ChannelImage;
        etf: EdgeTangentFlow;
        sharpened: ChannelImage;
        thresholded: ChannelImage;
        smoothed: ChannelImage;
    }>;
    /**
     * Convenience method to process ImageData directly
     */
    processGrayscaleImageData(input: ImageData, overrides?: Partial<FDoGConfig>): Promise<ImageData>;
    /**
     * Process with a pre-computed ETF
     *
     * Useful when processing multiple frames of video where the ETF
     * can be computed once and reused, or interpolated between keyframes.
     */
    processWithETF(input: ChannelImage, etf: EdgeTangentFlow, overrides?: Partial<FDoGConfig>): Promise<ChannelImage>;
    /**
     * Apply only the anti-aliasing pass to an already-processed image
     */
    applyAntiAliasing(input: ChannelImage, etf: EdgeTangentFlow, sigmaA?: number): Promise<ChannelImage>;
    /**
     * Get current configuration
     */
    getConfig(): Readonly<FDoGConfig>;
    /**
     * Update configuration
     */
    setConfig(config: Partial<FDoGConfig>): void;
}
/**
 * Convenience function for one-shot FDoG processing
 */
export declare function fdog(input: ChannelImage, config?: Partial<FDoGConfig>): Promise<ChannelImage>;
//# sourceMappingURL=fdog.d.ts.map