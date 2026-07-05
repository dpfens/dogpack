/**
 * High-level XDoG and FDoG implementations
 *
 * These classes provide convenient wrappers that compose the blur strategies
 * and DoG processor together.
 *
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 */
import { ChannelImage, DoGConfig, FDoGConfig, STYLE_PRESETS, FDOG_STYLE_PRESETS, BlurStrategy, DoGImplementation, DoGProcessingResult } from './types.js';
import { EdgeTangentFlow } from './etf/index.js';
/**
 * XDoG configuration combining DoG parameters with isotropic blur options
 */
export interface XDoGConfig extends DoGConfig {
    /** Kernel size multiplier for Gaussian blur (default: 6) */
    kernelSizeMultiplier?: number;
    blurStrategy?: BlurStrategy;
}
/**
 * XDoG (Extended Difference of Gaussians)
 *
 * Uses standard isotropic Gaussian blur for edge detection and stylization.
 * Good for general-purpose edge detection and artistic effects.
 *
 * This implements the reparameterized XDoG from Section 2.5 of the paper,
 * using Equation 7 for the sharpening computation.
 */
export declare class XDoG implements DoGImplementation {
    private processor;
    private config;
    constructor(config?: Partial<XDoGConfig>);
    /**
     * Create XDoG with a preset style
     */
    static withPreset(presetName: keyof typeof STYLE_PRESETS): XDoG;
    /**
     * Process a grayscale image
     */
    process(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<ChannelImage>;
    /**
     * Process without thresholding (returns sharpened image)
     */
    processSharpened(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<ChannelImage>;
    /**
     * Get raw DoG response for visualization
     */
    processRawDoG(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<ChannelImage>;
    /**
     * Process and return all intermediate results
     *
     * This is more efficient than calling process(), processSharpened(), and
     * processRawDoG() separately as it only performs the blur operations once.
     *
     * Useful for:
     * - Hatching strategies that need the sharpened image
     * - Debugging and visualization
     * - Custom post-processing pipelines
     */
    processDetailed(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<DoGProcessingResult>;
    /**
     * Convenience method to process ImageData directly (e.g., from a canvas)
     */
    processGrayscaleImageData(input: ImageData, overrides?: Partial<DoGConfig>): Promise<ImageData>;
    /**
     * Get current configuration
     */
    getConfig(): Readonly<XDoGConfig>;
    /**
     * Update configuration
     */
    setConfig(config: Partial<XDoGConfig>): void;
}
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
     * Compute Edge Tangent Flow separately
     *
     * Useful for visualizing the flow field or reusing it across frames.
     */
    computeETF(input: ChannelImage, sigmaC?: number): EdgeTangentFlow;
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
 * Convenience function for one-shot XDoG processing
 */
export declare function xdog(input: ChannelImage, config?: Partial<XDoGConfig>): Promise<ChannelImage>;
/**
 * Convenience function for one-shot FDoG processing
 */
export declare function fdog(input: ChannelImage, config?: Partial<FDoGConfig>): Promise<ChannelImage>;
//# sourceMappingURL=xdog.d.ts.map