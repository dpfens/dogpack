/**
 * High-level XDoG and FDoG implementations
 *
 * These classes provide convenient wrappers that compose the blur strategies
 * and DoG processor together.
 *
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 */
import { DEFAULT_DOG_CONFIG, DEFAULT_ETF_CONFIG, DEFAULT_FDOG_CONFIG, STYLE_PRESETS, FDOG_STYLE_PRESETS } from './types.js';
import { DoGProcessor } from './dog.js';
import { EdgeTangentFlow } from './etf/index.js';
import { imageDataToGrayscale, grayscaleToImageData } from './utils.js';
import { IsotropicBlur } from './blur/isotropic.js';
import { GradientAlignedBlur } from './blur/gradient-aligned.js';
import { FlowGuidedBlur } from './blur/flow-guided.js';
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
        const blurStrategy = new IsotropicBlur({
            kernelSizeMultiplier: this.config.kernelSizeMultiplier,
        });
        this.processor = new DoGProcessor(blurStrategy, dogConfig);
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
export class FDoG {
    config;
    constructor(config = {}) {
        this.config = {
            ...DEFAULT_FDOG_CONFIG,
            ...config,
        };
    }
    /**
     * Create FDoG with a preset style
     */
    static withPreset(presetName) {
        return new FDoG(FDOG_STYLE_PRESETS[presetName]);
    }
    /**
     * Process a grayscale image
     *
     * Unlike XDoG, FDoG computes a new flow field for each image,
     * so the full pipeline runs fresh each time.
     */
    async process(input, overrides = {}) {
        const params = { ...this.config, ...overrides };
        // Step 1: Compute Edge Tangent Flow
        const etf = EdgeTangentFlow.compute(input, {
            iterations: DEFAULT_ETF_CONFIG.iterations,
            kernelSize: Math.ceil(params.sigmaC * 2.45) * 2 + 1,
        }, params.sigmaC);
        const gradientBlur = new GradientAlignedBlur(etf);
        const processor = new DoGProcessor(gradientBlur, params);
        // Step 4: Process image (DoG + threshold)
        let result = await processor.process(input);
        const flowBlur = new FlowGuidedBlur(etf);
        // Step 5: Flow-aligned smoothing
        if (params.sigmaM > 0) {
            result = await flowBlur.blur(result, params.sigmaM);
        }
        // Step 6: Anti-aliasing
        if (params.sigmaA > 0) {
            result = await flowBlur.blur(result, params.sigmaA);
        }
        return result;
    }
    /**
     * Process with more control over individual stages
     */
    async processDetailed(input, overrides = {}) {
        const params = { ...this.config, ...overrides };
        // Compute ETF
        const etf = EdgeTangentFlow.compute(input, {
            iterations: DEFAULT_ETF_CONFIG.iterations,
            kernelSize: Math.ceil(params.sigmaC * 2.45) * 2 + 1,
        }, params.sigmaC);
        // Create blur strategies
        const gradientBlur = new GradientAlignedBlur(etf);
        const processor = new DoGProcessor(gradientBlur, params);
        // Get intermediate results
        const sharpened = await processor.processNoThreshold(input);
        const thresholded = await processor.process(input);
        // Flow-aligned smoothing
        let smoothed = thresholded;
        if (params.sigmaM > 0) {
            const flowBlur = new FlowGuidedBlur(etf);
            smoothed = await flowBlur.blur(thresholded, params.sigmaM);
        }
        // Anti-aliasing
        let result = smoothed;
        if (params.sigmaA > 0) {
            const flowCls = FlowGuidedBlur;
            const aaBlur = new flowCls(etf);
            result = await aaBlur.blur(smoothed, params.sigmaA);
        }
        return { result, etf, sharpened, thresholded, smoothed };
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
        const gradientBlur = new GradientAlignedBlur(etf);
        const processor = new DoGProcessor(gradientBlur, params);
        let result = await processor.process(input);
        const flowCls = FlowGuidedBlur;
        if (params.sigmaM > 0) {
            const flowBlur = new flowCls(etf);
            result = await flowBlur.blur(result, params.sigmaM);
        }
        if (params.sigmaA > 0) {
            const aaBlur = new flowCls(etf);
            result = await aaBlur.blur(result, params.sigmaA);
        }
        return result;
    }
    /**
     * Compute Edge Tangent Flow separately
     *
     * Useful for visualizing the flow field or reusing it across frames.
     */
    computeETF(input, sigmaC) {
        const sigma = sigmaC ?? this.config.sigmaC;
        return EdgeTangentFlow.compute(input, {
            iterations: DEFAULT_ETF_CONFIG.iterations,
            kernelSize: Math.ceil(sigma * 2.45) * 2 + 1,
        }, sigma);
    }
    /**
     * Apply only the anti-aliasing pass to an already-processed image
     */
    async applyAntiAliasing(input, etf, sigmaA) {
        const sigma = sigmaA ?? this.config.sigmaA;
        if (sigma <= 0) {
            return { data: new Float32Array(input.data), width: input.width, height: input.height };
        }
        const flowCls = FlowGuidedBlur;
        const aaBlur = new flowCls(etf);
        return aaBlur.blur(input, sigma);
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
/**
 * Convenience function for one-shot XDoG processing
 */
export async function xdog(input, config = {}) {
    const processor = new XDoG(config);
    if ('data' in input && input.data instanceof Uint8ClampedArray) {
        const grayscale = imageDataToGrayscale(input);
        return processor.process(grayscale);
    }
    return processor.process(input);
}
/**
 * Convenience function for one-shot FDoG processing
 */
export async function fdog(input, config = {}) {
    const processor = new FDoG(config);
    if ('data' in input && input.data instanceof Uint8ClampedArray) {
        const grayscale = imageDataToGrayscale(input);
        return processor.process(grayscale);
    }
    return processor.process(input);
}
//# sourceMappingURL=xdog.js.map