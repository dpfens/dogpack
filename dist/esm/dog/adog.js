/**
 * High-level ADog implementations
 *
 * These classes provide convenient wrappers that compose the blur strategies
 * and DoG processor together.
 */
import {} from '../interfaces/base.js';
import { createChannelImage, imageDataToLuminance, luminanceToImageData } from '../utils/index.js';
import { IsotropicBlur } from '../blur/isotropic.js';
import { DEFAULT_ADOG_CONFIG } from '../interfaces/dog.js';
export class ADoG {
    config;
    blurStrategy;
    constructor(config = {}) {
        this.config = { ...DEFAULT_ADOG_CONFIG, kernelSizeMultiplier: 6, ...config };
        this.blurStrategy = IsotropicBlur.create({
            kernelSizeMultiplier: this.config.kernelSizeMultiplier,
        });
    }
    dispose() {
        this.blurStrategy.then(strategy => strategy.dispose());
    }
    /**
     * Analytical epsilon ceiling for a given tau: beyond this, no flat
     * region (however bright) can cross threshold, and the output floods
     * to solid black regardless of image content. Pure function of tau,
     * so it's sync and doesn't need an input image or a processor instance.
     */
    static getEpsilonCeiling(tau) {
        return 1 - tau;
    }
    /**
     * Runs the pipeline once and returns mean/std of the pre-threshold
     * sharpened response, plus the tau-derived ceiling. Shared by
     * estimateEpsilon() and getEpsilonRange() so they don't each pay for
     * their own processDetailed() pass.
     */
    static async computeEpsilonStats(input, config = {}) {
        const processor = new ADoG(config);
        try {
            const { sharpened } = await processor.processDetailed(input);
            const n = sharpened.data.length;
            let sum = 0;
            for (let i = 0; i < n; i++)
                sum += sharpened.data[i];
            const mean = sum / n;
            let sqDiff = 0;
            for (let i = 0; i < n; i++)
                sqDiff += (sharpened.data[i] - mean) ** 2;
            const std = Math.sqrt(sqDiff / n);
            const tau = config.tau ?? DEFAULT_ADOG_CONFIG.tau;
            return { mean, std, ceiling: ADoG.getEpsilonCeiling(tau) };
        }
        finally {
            processor.dispose();
        }
    }
    /**
     * Recommended [min, max] band for the epsilon slider, plus a sensible
     * default, derived from the actual image + config rather than the
     * static ADOG_PARAM_RANGES.epsilon entry (which can't account for
     * tau/s/noiseScaleC/image content).
     */
    static async getEpsilonRange(input, config = {}, spread = 1.5) {
        const { mean, std, ceiling } = await ADoG.computeEpsilonStats(input, config);
        return {
            hardMin: 0,
            recommendedMin: Math.max(0, mean - spread * std),
            recommendedMax: Math.min(ceiling, mean + spread * std),
            hardMax: 0.2,
            default: mean,
            step: 0.001
        };
    }
    /** Existing method, now built on computeEpsilonStats. */
    static async estimateEpsilon(input, config = {}, biasOffset = 0) {
        const { mean } = await ADoG.computeEpsilonStats(input, config);
        return mean - biasOffset;
    }
    /**
     * Analytical epsilon ceiling for a given tau: beyond this, no flat
     * region (however bright) can cross threshold, and the output floods
     * to solid black regardless of image content. Pure function of tau,
     * so it's sync and doesn't need an input image or a processor instance.
     */
    static getEpsilonMax(tau) {
        return 1 - tau;
    }
    static estimateSigma(input, { referenceDimension = 700, baseSigma = 1.0 } = {}) {
        const scale = Math.min(input.width, input.height) / referenceDimension;
        return baseSigma * Math.max(1, scale);
    }
    /**
     * Process a grayscale image through the ADoG pipeline.
     */
    async process(input, overrides = {}) {
        const { result } = await this.processDetailed(input, overrides);
        return result;
    }
    async processDetailed(input, overrides = {}) {
        const params = { ...this.config, ...overrides };
        // Step 1: tone-adaptive noise injection, applied before blurring.
        // Skipped entirely when noiseScaleC is 0 (noise injection is optional,
        // see Figs. 7 vs 8 in the paper).
        const noisyInput = params.noiseScaleC > 0
            ? this.injectAdaptiveNoise(input, params.noiseScaleC, params.s)
            : input;
        // Step 2: two isotropic Gaussian blurs -- sigma = sigmaC, k*sigmaC = sigmaS
        const blurStrategy = await this.blurStrategy;
        const [blurC, blurS] = await Promise.all([
            blurStrategy.blur(noisyInput, params.sigma),
            blurStrategy.blur(noisyInput, params.sigma * params.k),
        ]);
        // Step 3 (Eq. 5): per-pixel adaptive weight rho(x), computed from the
        // ORIGINAL (pre-noise) input tone -- not from the blurred images.
        const rhoMap = this.computeRhoMap(input, params.tau, params.s);
        // Step 4 (Eq. 4): ADoG(x) = G_sigmaC(x) - rho(x) * G_sigmaS(x)
        const sharpened = this.computeWeightedDoG(blurC, blurS, rhoMap);
        // Unweighted response (rho == 1 everywhere), i.e. standard DoG --
        // exposed for comparison purposes (Fig. 7(b) in the paper).
        const rawDoG = this.computeUnweightedDoG(blurC, blurS);
        // Step 5: binarize (hard threshold by default via config.thresholdStrategy)
        const result = this.config.thresholdStrategy.threshold(sharpened, {
            epsilon: params.epsilon,
            phi: params.phi,
        });
        return { result, sharpened, rawDoG, rhoMap, noisyInput };
    }
    /**
     * Convenience method to process ImageData directly (e.g., from a canvas),
     * matching XDoG/FDoG's convenience method of the same name.
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
        return { ...this.config };
    }
    /**
     * Update configuration
     */
    async setConfig(config) {
        if (config.kernelSizeMultiplier !== undefined) {
            this.blurStrategy = IsotropicBlur.create({ kernelSizeMultiplier: config.kernelSizeMultiplier });
        }
        this.config = { ...this.config, ...config };
    }
    /** Eq. (5): rho(x) = tau + (1 - tau) * (1 - tanh(s * I(x))) */
    computeRhoMap(input, tau, s) {
        const output = createChannelImage(input.width, input.height);
        for (let i = 0; i < input.data.length; i++) {
            output.data[i] = tau + (1 - tau) * (1 - Math.tanh(s * input.data[i]));
        }
        return output;
    }
    /** Eq. (6): sigma(x) = c * (1 - tanh(s * I(x))); sampled noise ~ N(0,1) * sigma(x) added to I(x) */
    injectAdaptiveNoise(input, c, s) {
        const output = createChannelImage(input.width, input.height);
        for (let i = 0; i < input.data.length; i++) {
            const sigma = c * (1 - Math.tanh(s * input.data[i]));
            output.data[i] = input.data[i] + sigma * gaussianSample();
        }
        return output;
    }
    /** Eq. (3)/(4): ADoG(x) = G_sigmaC(x) - rho(x) * G_sigmaS(x) */
    computeWeightedDoG(blurC, blurS, rho) {
        const output = createChannelImage(blurC.width, blurC.height);
        for (let i = 0; i < blurC.data.length; i++) {
            output.data[i] = blurC.data[i] - rho.data[i] * blurS.data[i];
        }
        return output;
    }
    /** Standard (non-adaptive) DoG: G_sigmaC(x) - G_sigmaS(x), i.e. rho == 1 everywhere */
    computeUnweightedDoG(blurC, blurS) {
        const output = createChannelImage(blurC.width, blurC.height);
        for (let i = 0; i < blurC.data.length; i++) {
            output.data[i] = blurC.data[i] - blurS.data[i];
        }
        return output;
    }
}
/**
 * Sample a single value from a standard normal distribution N(0, 1)
 * using the Box-Muller transform.
 *
 * Used by ADoG's adaptive noise injection (Eq. 6): the sampled value is
 * scaled by a tone-dependent sigma(x) and added to the input luminance.
 */
function gaussianSample() {
    // Avoid Math.log(0) by excluding 0 from the uniform sample
    let u1 = 0;
    while (u1 === 0) {
        u1 = Math.random();
    }
    const u2 = Math.random();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}
/**
 * Convenience function for one-shot ADoG processing, matching xdog()/fdog()
 * in dog.ts
 */
export async function adog(input, config = {}) {
    const processor = new ADoG(config);
    const result = await processor.process(input);
    processor.dispose();
    return result;
}
//# sourceMappingURL=adog.js.map