/**
 * High-level XDoG implementation
 *
 * This class provides a convenient wrapper that compose the blur strategies
 * and DoG processor together.
 *
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 */
import {} from '../types.js';
import { DoGProcessor } from '../processor.js';
import { imageDataToLuminance, luminanceToImageData } from '../utils/index.js';
import { IsotropicBlur } from '../blur/isotropic.js';
import { DEFAULT_DOG_CONFIG, STYLE_PRESETS } from './types.js';
/**
 * XDoG (Extended Difference of Gaussians)
 *
 * Uses standard isotropic Gaussian blur for edge detection and stylization.
 * Good for general-purpose edge detection and artistic effects.
 *
 * This implements the reparameterized XDoG from Section 2.5 of the paper,
 * using Equation 7 for the sharpening computation.
 */
export class XDoG {
    processor;
    config;
    constructor(config = {}) {
        const { kernelSizeMultiplier, ...dogConfig } = config;
        this.config = { ...DEFAULT_DOG_CONFIG, kernelSizeMultiplier: 6, ...config };
        const blurStrategy = config.blurStrategy ?? new IsotropicBlur({
            kernelSizeMultiplier: this.config.kernelSizeMultiplier,
        });
        this.processor = new DoGProcessor(blurStrategy, dogConfig);
    }
    dispose() {
        this.processor.dispose();
    }
    /**
     * Create XDoG with a preset style
     */
    static withPreset(presetName) {
        return new XDoG(STYLE_PRESETS[presetName]);
    }
    /**
     * Process a grayscale image
     */
    async process(input, overrides = {}) {
        return this.processor.process(input, overrides);
    }
    /**
     * Process without thresholding (returns sharpened image)
     */
    async processSharpened(input, overrides = {}) {
        return this.processor.processNoThreshold(input, overrides);
    }
    /**
     * Get raw DoG response for visualization
     */
    async processRawDoG(input, overrides = {}) {
        return this.processor.processRawDoG(input, overrides);
    }
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
    async processDetailed(input, overrides = {}) {
        return this.processor.processDetailed(input, overrides);
    }
    /**
     * Convenience method to process ImageData directly (e.g., from a canvas)
     */
    async processGrayscaleImageData(input, overrides = {}) {
        const grayscale = imageDataToLuminance(input);
        const result = await this.process(grayscale, overrides);
        return luminanceToImageData(result);
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config, ...this.processor.getConfig() };
    }
    /**
     * Update configuration
     */
    setConfig(config) {
        const { kernelSizeMultiplier, ...dogConfig } = config;
        if (kernelSizeMultiplier !== undefined) {
            this.config.kernelSizeMultiplier = kernelSizeMultiplier;
            // Need to recreate blur strategy with new kernel size
            const blurStrategy = new IsotropicBlur({ kernelSizeMultiplier });
            this.processor.setBlurStrategy(blurStrategy);
        }
        this.processor.setConfig(dogConfig);
    }
}
/**
 * Convenience function for one-shot XDoG processing
 */
export async function xdog(input, config = {}) {
    const processor = new XDoG(config);
    const result = processor.process(input);
    processor.dispose();
    return result;
}
//# sourceMappingURL=xdog.js.map