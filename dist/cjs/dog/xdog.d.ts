/**
 * High-level XDoG implementation
 *
 * This class provides a convenient wrapper that compose the blur strategies
 * and DoG processor together.
 *
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 */
import { type ChannelImage } from '../interfaces/base.js';
import { STYLE_PRESETS, type DoGConfig, type DoGImplementation, type DoGProcessingResult, type XDoGConfig } from '../interfaces/dog.js';
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
    private config;
    private dogConfig;
    private blurStrategyPromise;
    constructor(config?: Partial<XDoGConfig>);
    dispose(): void;
    /**
     * Create XDoG with a preset style
     */
    static withPreset(presetName: keyof typeof STYLE_PRESETS): XDoG;
    private getProcessor;
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
     * Get current configuration.
     *
     * NOTE: the original merged in `this.processor.getConfig()`, which may
     * have applied its own internal defaulting on top of the raw dogConfig
     * we constructed it with. Without a persistent processor to ask, this
     * returns XDoG's own resolved config plus the raw (possibly
     * not-fully-defaulted) dogConfig. If DoGProcessor.getConfig() does
     * meaningful default-filling beyond what's here, please point me to
     * processor.ts and I'll fold that logic in.
     */
    getConfig(): Readonly<XDoGConfig>;
    /**
     * Update configuration. Stays synchronous — a kernelSizeMultiplier
     * change starts a new `IsotropicBlur.create()` and swaps in the new
     * promise immediately, without waiting for it to resolve. The old
     * strategy is disposed once it (already long-since resolved, in
     * practice) settles.
     *
     * KNOWN RACE: if a process*() call is in flight — meaning it already
     * awaited the *old* blurStrategyPromise and is mid-call on that
     * strategy — and setConfig() runs before that call's `finally`
     * completes, the old strategy could be disposed out from under it.
     * This existed in some form in the original code too (no serialization
     * between setConfig and in-flight process() calls). If that matters for
     * your usage, serialize calls at the call site.
     */
    setConfig(config: Partial<XDoGConfig>): void;
}
/**
 * Convenience function for one-shot XDoG processing
 */
export declare function xdog(input: ChannelImage, config?: Partial<XDoGConfig>): Promise<ChannelImage>;
//# sourceMappingURL=xdog.d.ts.map