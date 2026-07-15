"use strict";
/**
 * High-level XDoG implementation
 *
 * This class provides a convenient wrapper that compose the blur strategies
 * and DoG processor together.
 *
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.XDoG = void 0;
exports.xdog = xdog;
const processor_js_1 = require("../processor.js");
const index_js_1 = require("../utils/index.js");
const isotropic_js_1 = require("../blur/isotropic.js");
const dog_js_1 = require("../interfaces/dog.js");
/**
 * XDoG (Extended Difference of Gaussians)
 *
 * Uses standard isotropic Gaussian blur for edge detection and stylization.
 * Good for general-purpose edge detection and artistic effects.
 *
 * This implements the reparameterized XDoG from Section 2.5 of the paper,
 * using Equation 7 for the sharpening computation.
 */
class XDoG {
    config;
    dogConfig;
    blurStrategyPromise;
    constructor(config = {}) {
        const { kernelSizeMultiplier, blurStrategy, ...dogConfig } = config;
        this.config = { ...dog_js_1.DEFAULT_DOG_CONFIG, kernelSizeMultiplier: 6, ...config };
        this.dogConfig = dogConfig;
        // Not awaited here — just started. Anything that needs the resolved
        // strategy (process*(), dispose()) awaits this promise itself.
        this.blurStrategyPromise = Promise.resolve(blurStrategy ??
            isotropic_js_1.IsotropicBlur.create({ kernelSizeMultiplier: this.config.kernelSizeMultiplier }));
    }
    dispose() {
        this.blurStrategyPromise.then((strategy) => strategy.dispose()).catch(() => { });
    }
    /**
     * Create XDoG with a preset style
     */
    static withPreset(presetName) {
        return new XDoG(dog_js_1.STYLE_PRESETS[presetName]);
    }
    async getProcessor() {
        const strategy = await this.blurStrategyPromise;
        return new processor_js_1.DoGProcessor(strategy, this.dogConfig);
    }
    /**
     * Process a grayscale image
     */
    async process(input, overrides = {}) {
        const processor = await this.getProcessor();
        try {
            return await processor.process(input, overrides);
        }
        finally {
            processor.dispose();
        }
    }
    /**
     * Process without thresholding (returns sharpened image)
     */
    async processSharpened(input, overrides = {}) {
        const processor = await this.getProcessor();
        try {
            return await processor.processNoThreshold(input, overrides);
        }
        finally {
            processor.dispose();
        }
    }
    /**
     * Get raw DoG response for visualization
     */
    async processRawDoG(input, overrides = {}) {
        const processor = await this.getProcessor();
        try {
            return await processor.processRawDoG(input, overrides);
        }
        finally {
            processor.dispose();
        }
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
        const processor = await this.getProcessor();
        try {
            return await processor.processDetailed(input, overrides);
        }
        finally {
            processor.dispose();
        }
    }
    /**
     * Convenience method to process ImageData directly (e.g., from a canvas)
     */
    async processGrayscaleImageData(input, overrides = {}) {
        const grayscale = (0, index_js_1.imageDataToLuminance)(input);
        const result = await this.process(grayscale, overrides);
        return (0, index_js_1.luminanceToImageData)(result);
    }
    /**
     * Get current configuration.
     *
     * NOTE: the original merged in `this.processor.getConfig()`, which may
     * have applied its own internal defaulting on top of the raw dogConfig
     * we constructed it with. Without a persistent processor to ask, this
     * returns XDoG's own resolved config plus the raw (possibly
     * not-fully-defaulted) dogConfig. If DoGProcessor.getConfig() does
     * meaningful default-filling beyond what's here, please point me to
     * processor.ts and I'll fold that logic in.
     */
    getConfig() {
        return { ...this.config, ...this.dogConfig };
    }
    /**
     * Update configuration. Stays synchronous — a kernelSizeMultiplier
     * change starts a new `IsotropicBlur.create()` and swaps in the new
     * promise immediately, without waiting for it to resolve. The old
     * strategy is disposed once it (already long-since resolved, in
     * practice) settles.
     *
     * KNOWN RACE: if a process*() call is in flight — meaning it already
     * awaited the *old* blurStrategyPromise and is mid-call on that
     * strategy — and setConfig() runs before that call's `finally`
     * completes, the old strategy could be disposed out from under it.
     * This existed in some form in the original code too (no serialization
     * between setConfig and in-flight process() calls). If that matters for
     * your usage, serialize calls at the call site.
     */
    setConfig(config) {
        const { kernelSizeMultiplier, blurStrategy, ...dogConfig } = config;
        this.config = { ...this.config, ...config };
        this.dogConfig = { ...this.dogConfig, ...dogConfig };
        if (blurStrategy !== undefined) {
            const oldStrategyPromise = this.blurStrategyPromise;
            this.blurStrategyPromise = Promise.resolve(blurStrategy);
            oldStrategyPromise.then((s) => s.dispose()).catch(() => { });
        }
        else if (kernelSizeMultiplier !== undefined) {
            const oldStrategyPromise = this.blurStrategyPromise;
            this.blurStrategyPromise = isotropic_js_1.IsotropicBlur.create({ kernelSizeMultiplier });
            oldStrategyPromise.then((s) => s.dispose()).catch(() => { });
        }
    }
}
exports.XDoG = XDoG;
/**
 * Convenience function for one-shot XDoG processing
 */
async function xdog(input, config = {}) {
    const processor = new XDoG(config);
    const result = await processor.process(input);
    processor.dispose();
    return result;
}
//# sourceMappingURL=xdog.js.map