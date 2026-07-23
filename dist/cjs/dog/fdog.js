"use strict";
/**
 * High-level FDoG implementation
 *
 * This class provides a convenient wrapper that compose the blur strategies
 * and DoG processor together.
 *
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FDoG = void 0;
exports.blendByConfidence = blendByConfidence;
exports.scaleByMagnitude = scaleByMagnitude;
exports.computeEpsilonMap = computeEpsilonMap;
exports.fdog = fdog;
const base_js_1 = require("../interfaces/base.js");
const processor_js_1 = require("../processor.js");
const index_js_1 = require("../etf/index.js");
const index_js_2 = require("../utils/index.js");
const index_js_3 = require("../blur/gradient-aligned/index.js");
const flow_guided_js_1 = require("../blur/flow-guided.js");
const dog_js_1 = require("../interfaces/dog.js");
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
            ...dog_js_1.DEFAULT_FDOG_CONFIG,
            ...config,
        };
    }
    dispose() {
    }
    /**
     * Create FDoG with a preset style
     */
    static withPreset(presetName) {
        return new FDoG(dog_js_1.FDOG_STYLE_PRESETS[presetName]);
    }
    /**
     * Process a grayscale image
     *
     * Unlike XDoG, FDoG computes a new flow field for each image,
     * so the full pipeline runs fresh each time.
     */
    async process(input, overrides = {}) {
        const params = { ...this.config, ...overrides };
        const etfComputer = await index_js_1.EdgeTangentFlowComputer.create();
        const { flowField, magnitude, anisotropy } = await etfComputer.computeDetailed(input, {
            iterations: params.etfIterations ?? base_js_1.DEFAULT_ETF_CONFIG.iterations,
            kernelSize: Math.ceil(params.sigmaC * 2.45) * 2 + 1,
        }, params.sigmaC);
        const gradientBlur = await index_js_3.GradientAlignedBlur.create(flowField);
        // Only derive an adaptive p map if the developer opted in AND didn't
        // already hand us their own ChannelImage.
        const p = params.pByMagnitude && typeof params.p === 'number'
            ? scaleByMagnitude(magnitude, params.p)
            : params.p;
        const processor = new processor_js_1.DoGProcessor(gradientBlur, { ...params, p });
        let sharpened = await processor.processNoThreshold(input);
        const flowBlur = await flow_guided_js_1.FlowGuidedBlur.create(flowField);
        if (params.sigmaM > 0) {
            const flowSmoothed = await flowBlur.blur(sharpened, params.sigmaM);
            sharpened = params.weightFlowPassesByAnisotropy
                ? blendByConfidence(flowSmoothed, sharpened, anisotropy)
                : flowSmoothed;
        }
        const epsilon = params.epsilonByConfidence && typeof params.epsilon === 'number'
            ? computeEpsilonMap(anisotropy, magnitude, params.epsilon)
            : params.epsilon;
        let result = processor.applyThreshold(sharpened, epsilon, params.phi);
        processor.dispose();
        if (params.sigmaA > 0) {
            const aa = await flowBlur.blur(result, params.sigmaA);
            result = params.weightFlowPassesByAnisotropy
                ? blendByConfidence(aa, result, anisotropy)
                : aa;
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
        const etfComputer = await index_js_1.EdgeTangentFlowComputer.create();
        const etf = await etfComputer.compute(input, {
            iterations: base_js_1.DEFAULT_ETF_CONFIG.iterations,
            kernelSize: Math.ceil(params.sigmaC * 2.45) * 2 + 1,
        }, params.sigmaC);
        // Create blur strategies
        const gradientBlur = await index_js_3.GradientAlignedBlur.create(etf);
        const processor = new processor_js_1.DoGProcessor(gradientBlur, params);
        // Continuous (pre-threshold, pre-accumulation) DoG response.
        const rawSharpened = await processor.processNoThreshold(input);
        const flowBlur = await flow_guided_js_1.FlowGuidedBlur.create(etf);
        // Sec. 2.6: sigma_m flow-aligned accumulation is part of the FDoG
        // operator itself and must happen on the continuous response, before
        // thresholding.
        const sharpened = params.sigmaM > 0
            ? await flowBlur.blur(rawSharpened, params.sigmaM)
            : rawSharpened;
        // Threshold once -- this is the paper's "two tone result" (Fig. 6/7b),
        // computed from the sigma_m-accumulated continuous signal.
        const thresholded = processor.applyThreshold(sharpened, params.epsilon, params.phi);
        processor.dispose();
        // Sec. 4.3: sigma_a anti-aliasing is a separate POST-threshold pass --
        // a small LIC along the ETF applied to the binary/two-tone image to
        // soften its step-function edges. Not another round of pre-threshold
        // smoothing.
        const smoothed = params.sigmaA > 0
            ? await flowBlur.blur(thresholded, params.sigmaA)
            : thresholded;
        flowBlur.dispose();
        etfComputer.dispose();
        const result = smoothed;
        return { result, etf, sharpened, thresholded, smoothed };
    }
    /**
     * Convenience method to process ImageData directly
     */
    async processGrayscaleImageData(input, overrides = {}) {
        const grayscale = (0, index_js_2.imageDataToLuminance)(input);
        const result = await this.process(grayscale, overrides);
        return (0, index_js_2.luminanceToImageData)(result);
    }
    /**
     * Process with a pre-computed ETF
     *
     * Useful when processing multiple frames of video where the ETF
     * can be computed once and reused, or interpolated between keyframes.
     */
    async processWithETF(input, etf, overrides = {}) {
        const params = { ...this.config, ...overrides };
        const gradientBlur = await index_js_3.GradientAlignedBlur.create(etf);
        const processor = new processor_js_1.DoGProcessor(gradientBlur, params);
        // Continuous response -- do not threshold yet.
        let sharpened = await processor.processNoThreshold(input);
        // Sec. 2.6: pre-threshold flow accumulation.
        if (params.sigmaM > 0) {
            const flowBlur = await flow_guided_js_1.FlowGuidedBlur.create(etf);
            sharpened = await flowBlur.blur(sharpened, params.sigmaM);
            flowBlur.dispose();
        }
        let result = processor.applyThreshold(sharpened, params.epsilon, params.phi);
        processor.dispose();
        // Sec. 4.3: post-threshold anti-aliasing pass.
        if (params.sigmaA > 0) {
            const aaBlur = await flow_guided_js_1.FlowGuidedBlur.create(etf);
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
        const aaBlur = await flow_guided_js_1.FlowGuidedBlur.create(etf);
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
exports.FDoG = FDoG;
/** weight=1 trusts `a`, weight=0 trusts `b`. */
function blendByConfidence(a, b, confidence) {
    const out = (0, index_js_2.createChannelImage)(a.width, a.height);
    const size = a.width * a.height;
    for (let i = 0; i < size; i++) {
        const w = confidence.data[i];
        out.data[i] = w * a.data[i] + (1 - w) * b.data[i];
    }
    return out;
}
/** Scale a base scalar by normalized magnitude. */
function scaleByMagnitude(magnitude, base) {
    const out = (0, index_js_2.createChannelImage)(magnitude.width, magnitude.height);
    const size = magnitude.width * magnitude.height;
    let maxMag = 1e-6;
    for (let i = 0; i < size; i++)
        maxMag = Math.max(maxMag, magnitude.data[i]);
    for (let i = 0; i < size; i++)
        out.data[i] = base * (magnitude.data[i] / maxMag);
    return out;
}
/** Raise a base epsilon where anisotropy/magnitude confidence is low. */
function computeEpsilonMap(anisotropy, magnitude, base, margin = 0.15) {
    const out = (0, index_js_2.createChannelImage)(anisotropy.width, anisotropy.height);
    const size = anisotropy.width * anisotropy.height;
    let maxMag = 1e-6;
    for (let i = 0; i < size; i++)
        maxMag = Math.max(maxMag, magnitude.data[i]);
    for (let i = 0; i < size; i++) {
        const confidence = anisotropy.data[i] * (magnitude.data[i] / maxMag);
        out.data[i] = base + (1 - confidence) * margin;
    }
    return out;
}
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