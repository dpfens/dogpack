/**
 * High-level XDoG and FDoG implementations
 *
 * These classes provide convenient wrappers that compose the blur strategies
 * and DoG processor together.
 *
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 */
import { type ChannelImage } from '../types';
import { STYLE_PRESETS, type DoGConfig, type DoGImplementation, type DoGProcessingResult, type XDoGConfig } from './types';
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
    dispose(): void;
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
 * Convenience function for one-shot XDoG processing
 */
export declare function xdog(input: ChannelImage, config?: Partial<XDoGConfig>): Promise<ChannelImage>;
//# sourceMappingURL=xdog.d.ts.map