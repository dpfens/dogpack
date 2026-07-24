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
import { ScalarField, anisotropyField, normalizedMagnitudeField } from '../utils/scalar-field.js';
import { GradientAlignedBlur } from '../blur/gradient-aligned/index.js';
import { FlowGuidedBlur } from '../blur/flow-guided.js';
import { DEFAULT_FDOG_CONFIG, FDOG_STYLE_PRESETS, resolveConfidenceWeighting, } from '../interfaces/dog.js';
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
        const etfComputer = await EdgeTangentFlowComputer.create();
        const flowField = await etfComputer.compute(input, {
            iterations: params.etfIterations ?? DEFAULT_ETF_CONFIG.iterations,
            kernelSize: Math.ceil(params.sigmaC * 2.45) * 2 + 1,
        }, params.sigmaC);
        const weighting = resolveConfidenceWeighting(params.confidenceWeighting);
        const needsWeightingFields = weighting.pByMagnitude || weighting.sigmaMBlend || weighting.sigmaABlend || weighting.epsilonMargin > 0;
        const magnitude = needsWeightingFields ? normalizedMagnitudeField(flowField) : undefined;
        const confidence = needsWeightingFields ? ScalarField.scale(anisotropyField(flowField), magnitude) : undefined;
        const gradientBlur = await GradientAlignedBlur.create(flowField);
        console.log(params);
        // Only derive an adaptive p map if the developer opted in AND didn't
        // already hand us their own ChannelImage.
        const p = weighting.pByMagnitude && typeof params.p === 'number' && confidence
            ? ScalarField.materialize(ScalarField.scale(ScalarField.constant(params.p), confidence), input.width, input.height)
            : params.p;
        const processor = new DoGProcessor(gradientBlur, { ...params, p });
        let sharpened = await processor.processNoThreshold(input);
        const flowBlur = await FlowGuidedBlur.create(flowField);
        if (params.sigmaM > 0) {
            const flowSmoothed = await flowBlur.blur(sharpened, params.sigmaM);
            sharpened = weighting.sigmaMBlend
                ? blendByConfidence(flowSmoothed, sharpened, confidence)
                : flowSmoothed;
        }
        const epsilon = weighting.epsilonMargin > 0 && typeof params.epsilon === 'number'
            ? ScalarField.materialize(ScalarField.map(confidence, c => params.epsilon + (1 - c) * weighting.epsilonMargin), input.width, input.height)
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
        const etfComputer = await EdgeTangentFlowComputer.create();
        const etf = await etfComputer.compute(input, {
            iterations: DEFAULT_ETF_CONFIG.iterations,
            kernelSize: Math.ceil(params.sigmaC * 2.45) * 2 + 1,
        }, params.sigmaC);
        // Create blur strategies
        const gradientBlur = await GradientAlignedBlur.create(etf);
        const processor = new DoGProcessor(gradientBlur, params);
        // Continuous (pre-threshold, pre-accumulation) DoG response.
        const rawSharpened = await processor.processNoThreshold(input);
        const flowBlur = await FlowGuidedBlur.create(etf);
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
        // Continuous response -- do not threshold yet.
        let sharpened = await processor.processNoThreshold(input);
        // Sec. 2.6: pre-threshold flow accumulation.
        if (params.sigmaM > 0) {
            const flowBlur = await FlowGuidedBlur.create(etf);
            sharpened = await flowBlur.blur(sharpened, params.sigmaM);
            flowBlur.dispose();
        }
        let result = processor.applyThreshold(sharpened, params.epsilon, params.phi);
        processor.dispose();
        // Sec. 4.3: post-threshold anti-aliasing pass.
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
 * Blend two already-materialized images by a confidence field.
 * weight=1 trusts `a`, weight=0 trusts `b`.
 *
 * Unlike the p/epsilon adaptive maps (which stay lazy ScalarFields all
 * the way to processor.ts), `a`/`b` here are real per-call blur outputs;
 * there's no config-shaped ScalarField to hand off to, so this blends
 * and materializes eagerly via ScalarField.blend()/materialize() rather
 * than exposing another bespoke pixel loop.
 */
export function blendByConfidence(a, b, confidence) {
    return ScalarField.materialize(ScalarField.blend(ScalarField.fromChannelImage(a), ScalarField.fromChannelImage(b), confidence), a.width, a.height);
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