"use strict";
/**
 * High-level XDoG and FDoG implementations
 *
 * These classes provide convenient wrappers that compose the blur strategies
 * and DoG processor together.
 *
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FDoG = void 0;
exports.fdog = fdog;
const processor_1 = require("../processor");
const etf_1 = require("../etf");
const utils_1 = require("../utils");
const gradient_aligned_1 = require("../blur/gradient-aligned");
const flow_guided_1 = require("../blur/flow-guided");
const types_1 = require("./types");
const __1 = require("..");
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
class FDoG {
    config;
    constructor(config = {}) {
        this.config = {
            ...types_1.DEFAULT_FDOG_CONFIG,
            ...config,
        };
    }
    dispose() {
    }
    /**
     * Create FDoG with a preset style
     */
    static withPreset(presetName) {
        return new FDoG(types_1.FDOG_STYLE_PRESETS[presetName]);
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
        const etf = etf_1.EdgeTangentFlow.compute(input, {
            iterations: __1.DEFAULT_ETF_CONFIG.iterations,
            kernelSize: Math.ceil(params.sigmaC * 2.45) * 2 + 1,
        }, params.sigmaC);
        const gradientBlur = new gradient_aligned_1.GradientAlignedBlur(etf);
        const processor = new processor_1.DoGProcessor(gradientBlur, params);
        // Step 4: Process image (DoG + threshold)
        let result = await processor.process(input);
        processor.dispose();
        const flowBlur = new flow_guided_1.FlowGuidedBlur(etf);
        // Step 5: Flow-aligned smoothing
        if (params.sigmaM > 0) {
            result = await flowBlur.blur(result, params.sigmaM);
        }
        // Step 6: Anti-aliasing
        if (params.sigmaA > 0) {
            result = await flowBlur.blur(result, params.sigmaA);
        }
        flowBlur.dispose();
        etf_1.EdgeTangentFlow.dispose();
        return result;
    }
    /**
     * Process with more control over individual stages
     */
    async processDetailed(input, overrides = {}) {
        const params = { ...this.config, ...overrides };
        // Compute ETF
        const etf = etf_1.EdgeTangentFlow.compute(input, {
            iterations: __1.DEFAULT_ETF_CONFIG.iterations,
            kernelSize: Math.ceil(params.sigmaC * 2.45) * 2 + 1,
        }, params.sigmaC);
        // Create blur strategies
        const gradientBlur = new gradient_aligned_1.GradientAlignedBlur(etf);
        const processor = new processor_1.DoGProcessor(gradientBlur, params);
        // Get intermediate results
        const [sharpened, thresholded] = await Promise.all([
            processor.processNoThreshold(input),
            processor.process(input)
        ]);
        // Flow-aligned smoothing
        let smoothed = thresholded;
        if (params.sigmaM > 0) {
            const flowBlur = new flow_guided_1.FlowGuidedBlur(etf);
            smoothed = await flowBlur.blur(thresholded, params.sigmaM);
            flowBlur.dispose();
        }
        // Anti-aliasing
        let result = smoothed;
        if (params.sigmaA > 0) {
            const flowCls = flow_guided_1.FlowGuidedBlur;
            const aaBlur = new flowCls(etf);
            result = await aaBlur.blur(smoothed, params.sigmaA);
            aaBlur.dispose();
        }
        etf_1.EdgeTangentFlow.dispose();
        return { result, etf, sharpened, thresholded, smoothed };
    }
    /**
     * Convenience method to process ImageData directly
     */
    async processGrayscaleImageData(input, overrides = {}) {
        const grayscale = (0, utils_1.imageDataToLuminance)(input);
        const result = await this.process(grayscale, overrides);
        return (0, utils_1.luminanceToImageData)(result);
    }
    /**
     * Process with a pre-computed ETF
     *
     * Useful when processing multiple frames of video where the ETF
     * can be computed once and reused, or interpolated between keyframes.
     */
    async processWithETF(input, etf, overrides = {}) {
        const params = { ...this.config, ...overrides };
        const gradientBlur = new gradient_aligned_1.GradientAlignedBlur(etf);
        const processor = new processor_1.DoGProcessor(gradientBlur, params);
        let result = await processor.process(input);
        processor.dispose();
        const flowCls = flow_guided_1.FlowGuidedBlur;
        if (params.sigmaM > 0) {
            const flowBlur = new flowCls(etf);
            result = await flowBlur.blur(result, params.sigmaM);
            flowBlur.dispose();
        }
        if (params.sigmaA > 0) {
            const aaBlur = new flowCls(etf);
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
        const flowCls = flow_guided_1.FlowGuidedBlur;
        const aaBlur = new flowCls(etf);
        const result = aaBlur.blur(input, sigma);
        aaBlur.dispose();
        etf_1.EdgeTangentFlow.dispose();
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
exports.FDoG = FDoG;
/**
 * Convenience function for one-shot FDoG processing
 */
async function fdog(input, config = {}) {
    const processor = new FDoG(config);
    const result = processor.process(input);
    processor.dispose();
    return result;
}
//# sourceMappingURL=fdog.js.map