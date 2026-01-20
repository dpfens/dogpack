/**
 * High-level XDoG and FDoG implementations
 *
 * These classes provide convenient wrappers that compose the blur strategies
 * and DoG processor together.
 */
import { DEFAULT_DOG_CONFIG, DEFAULT_ETF_CONFIG } from './types.js';
import { DoGProcessor } from './dog.js';
import { IsotropicBlur, FlowGuidedBlur } from './blur.js';
import { EdgeTangentFlow } from './etf.js';
import { imageDataToGrayscale, grayscaleToImageData } from './utils.js';
/**
 * XDoG (Extended Difference of Gaussians)
 *
 * Uses standard isotropic Gaussian blur for edge detection and stylization.
 * Good for general-purpose edge detection and artistic effects.
 */
export class XDoG {
    processor;
    config;
    constructor(config = {}) {
        const { kernelSizeMultiplier, ...dogConfig } = config;
        this.config = { ...DEFAULT_DOG_CONFIG, kernelSizeMultiplier: 6, ...config };
        const blurStrategy = new IsotropicBlur({
            kernelSizeMultiplier: this.config.kernelSizeMultiplier,
        });
        this.processor = new DoGProcessor(blurStrategy, dogConfig);
    }
    /**
     * Process a grayscale image
     */
    async process(input, overrides = {}) {
        return this.processor.process(input, overrides);
    }
    /**
     * Convenience method to process ImageData directly (e.g., from a canvas)
     */
    async processImageData(input, overrides = {}) {
        const grayscale = imageDataToGrayscale(input);
        const result = await this.process(grayscale, overrides);
        return grayscaleToImageData(result);
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
 * FDoG (Flow-based Difference of Gaussians)
 *
 * Uses flow-guided blur along edge tangent directions for coherent line drawing.
 * Produces smoother, more artistic results similar to hand-drawn illustrations.
 *
 * Note: FDoG is more computationally expensive than XDoG due to:
 * 1. Computing the Edge Tangent Flow field
 * 2. Line integral convolution for flow-guided blur
 */
export class FDoG {
    config;
    constructor(config = {}) {
        this.config = {
            ...DEFAULT_DOG_CONFIG,
            etfIterations: DEFAULT_ETF_CONFIG.iterations,
            etfKernelSize: DEFAULT_ETF_CONFIG.kernelSize,
            ...config,
        };
    }
    /**
     * Process a grayscale image
     *
     * Unlike XDoG, FDoG computes a new flow field for each image,
     * so the processor is created fresh each time.
     */
    async process(input, overrides = {}) {
        const params = { ...this.config, ...overrides };
        // Compute Edge Tangent Flow for this image
        const etf = EdgeTangentFlow.compute(input, {
            iterations: params.etfIterations,
            kernelSize: params.etfKernelSize,
        });
        // Create flow-guided blur strategy
        const blurStrategy = new FlowGuidedBlur(etf);
        // Create and run processor
        const processor = new DoGProcessor(blurStrategy, params);
        return processor.process(input);
    }
    /**
     * Convenience method to process ImageData directly
     */
    async processImageData(input, overrides = {}) {
        const grayscale = imageDataToGrayscale(input);
        const result = await this.process(grayscale, overrides);
        return grayscaleToImageData(result);
    }
    /**
     * Process with a pre-computed ETF
     *
     * Useful when processing multiple frames of video where the ETF
     * can be computed once and reused, or interpolated between keyframes.
     */
    async processWithETF(input, etf, overrides = {}) {
        const params = { ...this.config, ...overrides };
        const blurStrategy = new FlowGuidedBlur(etf);
        const processor = new DoGProcessor(blurStrategy, params);
        return processor.process(input);
    }
    /**
     * Compute Edge Tangent Flow separately
     *
     * Useful for visualizing the flow field or reusing it across frames.
     */
    computeETF(input, overrides = {}) {
        const params = {
            iterations: this.config.etfIterations ?? DEFAULT_ETF_CONFIG.iterations,
            kernelSize: this.config.etfKernelSize ?? DEFAULT_ETF_CONFIG.kernelSize,
            ...overrides,
        };
        return EdgeTangentFlow.compute(input, params);
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Update configuration
     */
    setConfig(config) {
        this.config = { ...this.config, ...config };
    }
}
//# sourceMappingURL=xdog.js.map