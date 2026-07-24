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
exports.fdog = fdog;
const base_js_1 = require("../interfaces/base.js");
const processor_js_1 = require("../processor.js");
const index_js_1 = require("../etf/index.js");
const index_js_2 = require("../utils/index.js");
const scalar_field_js_1 = require("../utils/scalar-field.js");
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
        const flowField = await etfComputer.compute(input, {
            iterations: params.etfIterations ?? base_js_1.DEFAULT_ETF_CONFIG.iterations,
            kernelSize: Math.ceil(params.sigmaC * 2.45) * 2 + 1,
        }, params.sigmaC);
        const weighting = (0, dog_js_1.resolveConfidenceWeighting)(params.confidenceWeighting);
        const needsWeightingFields = weighting.pByMagnitude || weighting.sigmaMBlend || weighting.sigmaABlend || weighting.epsilonMargin > 0;
        const magnitude = needsWeightingFields ? (0, scalar_field_js_1.normalizedMagnitudeField)(flowField) : undefined;
        const confidence = needsWeightingFields ? scalar_field_js_1.ScalarField.scale((0, scalar_field_js_1.anisotropyField)(flowField), magnitude) : undefined;
        const gradientBlur = await index_js_3.GradientAlignedBlur.create(flowField);
        console.log(params);
        // Only derive an adaptive p map if the developer opted in AND didn't
        // already hand us their own ChannelImage.
        const p = weighting.pByMagnitude && typeof params.p === 'number' && confidence
            ? scalar_field_js_1.ScalarField.materialize(scalar_field_js_1.ScalarField.scale(scalar_field_js_1.ScalarField.constant(params.p), confidence), input.width, input.height)
            : params.p;
        const processor = new processor_js_1.DoGProcessor(gradientBlur, { ...params, p });
        let sharpened = await processor.processNoThreshold(input);
        const flowBlur = await flow_guided_js_1.FlowGuidedBlur.create(flowField);
        if (params.sigmaM > 0) {
            const flowSmoothed = await flowBlur.blur(sharpened, params.sigmaM);
            sharpened = weighting.sigmaMBlend
                ? blendByConfidence(flowSmoothed, sharpened, confidence)
                : flowSmoothed;
        }
        const epsilon = weighting.epsilonMargin > 0 && typeof params.epsilon === 'number'
            ? scalar_field_js_1.ScalarField.materialize(scalar_field_js_1.ScalarField.map(confidence, c => params.epsilon + (1 - c) * weighting.epsilonMargin), input.width, input.height)
            : params.epsilon;
        let result = processor.applyThreshold(sharpened, epsilon, params.phi);
        processor.dispose();
        if (params.sigmaA > 0) {
            const aa = await flowBlur.blur(result, params.sigmaA);
            result = weighting.sigmaABlend
                ? blendByConfidence(aa, result, confidence)
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
/**
 * Blend two already-materialized images by a confidence field.
 * weight=1 trusts `a`, weight=0 trusts `b`.
 *
 * Unlike the p/epsilon adaptive maps (which stay lazy ScalarFields all
 * the way to processor.ts), `a`/`b` here are real per-call blur outputs;
 * there's no config-shaped ScalarField to hand off to, so this blends
 * and materializes eagerly via ScalarField.blend()/materialize() rather
 * than exposing another bespoke pixel loop.
 */
function blendByConfidence(a, b, confidence) {
    return scalar_field_js_1.ScalarField.materialize(scalar_field_js_1.ScalarField.blend(scalar_field_js_1.ScalarField.fromChannelImage(a), scalar_field_js_1.ScalarField.fromChannelImage(b), confidence), a.width, a.height);
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