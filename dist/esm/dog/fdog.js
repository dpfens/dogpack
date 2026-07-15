/**
 * High-level FDoG implementation
 *
 * This class provides a convenient wrapper that compose the blur strategies
 * and DoG processor together.
 *
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 */
import { DEFAULT_ETF_CONFIG, } from '../interfaces/base.js';
import { DoGProcessor } from '../processor.js';
import { EdgeTangentFlowComputer } from '../etf/index.js';
import { imageDataToLuminance, luminanceToImageData } from '../utils/index.js';
import { GradientAlignedBlur } from '../blur/gradient-aligned/index.js';
import { FlowGuidedBlur } from '../blur/flow-guided.js';
import { DEFAULT_FDOG_CONFIG, FDOG_STYLE_PRESETS } from '../interfaces/dog.js';
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
    dispose() {
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
        const etfComputer = await EdgeTangentFlowComputer.create();
        const etf = await etfComputer.compute(input, {
            iterations: DEFAULT_ETF_CONFIG.iterations,
            kernelSize: Math.ceil(params.sigmaC * 2.45) * 2 + 1,
        }, params.sigmaC);
        const gradientBlur = await GradientAlignedBlur.create(etf);
        const processor = new DoGProcessor(gradientBlur, params);
        // Step 4: Process image (DoG + threshold)
        let result = await processor.process(input);
        processor.dispose();
        const flowBlur = await FlowGuidedBlur.create(etf);
        // Step 5: Flow-aligned smoothing
        if (params.sigmaM > 0) {
            result = await flowBlur.blur(result, params.sigmaM);
        }
        // Step 6: Anti-aliasing
        if (params.sigmaA > 0) {
            result = await flowBlur.blur(result, params.sigmaA);
        }
        flowBlur.dispose();
        etfComputer.dispose();
        return result;
    }
    /**
     * Process with more control over individual stages
     */
    async processDetailed(input, overrides = {}) {
        const params = { ...this.config, ...overrides };
        // Compute ETF
        const etfComputer = await EdgeTangentFlowComputer.create();
        const etf = await etfComputer.compute(input, {
            iterations: DEFAULT_ETF_CONFIG.iterations,
            kernelSize: Math.ceil(params.sigmaC * 2.45) * 2 + 1,
        }, params.sigmaC);
        // Create blur strategies
        const gradientBlur = await GradientAlignedBlur.create(etf);
        const processor = new DoGProcessor(gradientBlur, params);
        // Get intermediate results
        const [sharpened, thresholded] = await Promise.all([
            processor.processNoThreshold(input),
            processor.process(input)
        ]);
        processor.dispose();
        // Flow-aligned smoothing
        let smoothed = thresholded;
        if (params.sigmaM > 0) {
            const flowBlur = await FlowGuidedBlur.create(etf);
            smoothed = await flowBlur.blur(thresholded, params.sigmaM);
            flowBlur.dispose();
        }
        // Anti-aliasing
        let result = smoothed;
        if (params.sigmaA > 0) {
            const aaBlur = await FlowGuidedBlur.create(etf);
            result = await aaBlur.blur(smoothed, params.sigmaA);
            aaBlur.dispose();
        }
        etfComputer.dispose();
        return { result, etf, sharpened, thresholded, smoothed };
    }
    /**
     * Convenience method to process ImageData directly
     */
    async processGrayscaleImageData(input, overrides = {}) {
        const grayscale = imageDataToLuminance(input);
        const result = await this.process(grayscale, overrides);
        return luminanceToImageData(result);
    }
    /**
     * Process with a pre-computed ETF
     *
     * Useful when processing multiple frames of video where the ETF
     * can be computed once and reused, or interpolated between keyframes.
     */
    async processWithETF(input, etf, overrides = {}) {
        const params = { ...this.config, ...overrides };
        const gradientBlur = await GradientAlignedBlur.create(etf);
        const processor = new DoGProcessor(gradientBlur, params);
        let result = await processor.process(input);
        processor.dispose();
        if (params.sigmaM > 0) {
            const flowBlur = await FlowGuidedBlur.create(etf);
            result = await flowBlur.blur(result, params.sigmaM);
            flowBlur.dispose();
        }
        if (params.sigmaA > 0) {
            const aaBlur = await FlowGuidedBlur.create(etf);
            result = await aaBlur.blur(result, params.sigmaA);
            aaBlur.dispose();
        }
        return result;
    }
    /**
     * Apply only the anti-aliasing pass to an already-processed image
     */
    async applyAntiAliasing(input, etf, sigmaA) {
        const sigma = sigmaA ?? this.config.sigmaA;
        if (sigma <= 0) {
            return { data: new Float32Array(input.data), width: input.width, height: input.height };
        }
        const aaBlur = await FlowGuidedBlur.create(etf);
        const result = aaBlur.blur(input, sigma);
        aaBlur.dispose();
        return result;
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
 * Convenience function for one-shot FDoG processing
 */
export async function fdog(input, config = {}) {
    const processor = new FDoG(config);
    const result = processor.process(input);
    processor.dispose();
    return result;
}
//# sourceMappingURL=fdog.js.map