"use strict";
/**
 * High-level ADog implementations
 *
 * These classes provide convenient wrappers that compose the blur strategies
 * and DoG processor together.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADoG = void 0;
exports.adog = adog;
const index_js_1 = require("../utils/index.js");
const isotropic_js_1 = require("../blur/isotropic.js");
const index_js_2 = require("../utils/index.js");
const dog_js_1 = require("../interfaces/dog.js");
class ADoG {
    config;
    blurStrategy;
    constructor(config = {}) {
        this.config = { ...dog_js_1.DEFAULT_ADOG_CONFIG, kernelSizeMultiplier: 6, ...config };
        this.blurStrategy = isotropic_js_1.IsotropicBlur.create({
            kernelSizeMultiplier: this.config.kernelSizeMultiplier,
        });
    }
    dispose() {
        this.blurStrategy.then(strategy => strategy.dispose());
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
        const { min, mean, max } = (() => {
            let min = Infinity, max = -Infinity, sum = 0;
            for (let i = 0; i < sharpened.data.length; i++) {
                const v = sharpened.data[i];
                if (v < min)
                    min = v;
                if (v > max)
                    max = v;
                sum += v;
            }
            return { min, mean: sum / sharpened.data.length, max };
        })();
        console.log(`sharpened: min=${min.toFixed(5)} mean=${mean.toFixed(5)} max=${max.toFixed(5)}`);
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
        const grayscale = (0, index_js_1.imageDataToLuminance)(input);
        const result = await this.process(grayscale, overrides);
        return (0, index_js_1.luminanceToImageData)(result);
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
            this.blurStrategy = isotropic_js_1.IsotropicBlur.create({ kernelSizeMultiplier: config.kernelSizeMultiplier });
        }
        this.config = { ...this.config, ...config };
    }
    /** Eq. (5): rho(x) = tau + (1 - tau) * (1 - tanh(s * I(x))) */
    computeRhoMap(input, tau, s) {
        const output = (0, index_js_1.createChannelImage)(input.width, input.height);
        for (let i = 0; i < input.data.length; i++) {
            output.data[i] = tau + (1 - tau) * (1 - Math.tanh(s * input.data[i]));
        }
        return output;
    }
    /** Eq. (6): sigma(x) = c * (1 - tanh(s * I(x))); sampled noise ~ N(0,1) * sigma(x) added to I(x) */
    injectAdaptiveNoise(input, c, s) {
        const output = (0, index_js_1.createChannelImage)(input.width, input.height);
        for (let i = 0; i < input.data.length; i++) {
            const sigma = c * (1 - Math.tanh(s * input.data[i]));
            output.data[i] = input.data[i] + sigma * (0, index_js_2.gaussianSample)();
        }
        return output;
    }
    /** Eq. (3)/(4): ADoG(x) = G_sigmaC(x) - rho(x) * G_sigmaS(x) */
    computeWeightedDoG(blurC, blurS, rho) {
        const output = (0, index_js_1.createChannelImage)(blurC.width, blurC.height);
        for (let i = 0; i < blurC.data.length; i++) {
            output.data[i] = blurC.data[i] - rho.data[i] * blurS.data[i];
        }
        return output;
    }
    /** Standard (non-adaptive) DoG: G_sigmaC(x) - G_sigmaS(x), i.e. rho == 1 everywhere */
    computeUnweightedDoG(blurC, blurS) {
        const output = (0, index_js_1.createChannelImage)(blurC.width, blurC.height);
        for (let i = 0; i < blurC.data.length; i++) {
            output.data[i] = blurC.data[i] - blurS.data[i];
        }
        return output;
    }
}
exports.ADoG = ADoG;
/**
 * Convenience function for one-shot ADoG processing, matching xdog()/fdog()
 * in dog.ts
 */
async function adog(input, config = {}) {
    const processor = new ADoG(config);
    const result = await processor.process(input);
    processor.dispose();
    return result;
}
//# sourceMappingURL=adog.js.map