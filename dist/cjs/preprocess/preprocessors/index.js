"use strict";
/**
 * Composed Preprocessing Module for XDoG/FDoG
 *
 * This module is the single entry point the rest of the codebase should
 * import from. It no longer does its own backend resolution (WebGPU >
 * WebGL > CPU, demote-on-failure, etc.) — that machinery lives once in
 * `ResilientEdgeAwareFilter` and is exercised through the
 * `EdgeAwareFilterCore`-shaped classes exported from `filters/filters.js`
 * (`BilateralFilter`, `MedianFilter`, `KuwaharaFilter`, `GaussianBlur`,
 * `ContrastEnhancer`, `Quantizer`).
 *
 * Every class here is a thin adapter from that `apply(input, params)`
 * shape to the simpler `Preprocessor` shape (`process(input)`, no
 * per-call params) that the rest of this pipeline expects: it remembers
 * the config passed to `create()` and forwards it into `apply()` on
 * every `process()` call. This is exactly the pattern `IsotropicBlur`
 * (blur/isotropic.ts) already uses to wrap `IsotropicBlurFilter`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.disposeWebGPU = exports.disposeWebGL = exports.isWebGLAvailable = exports.PreprocessingPipeline = exports.PreprocessingPresets = exports.LocalVariance = exports.Quantizer = exports.ContrastEnhancer = exports.GaussianBlur = exports.KuwaharaFilter = exports.MedianFilter = exports.BilateralFilter = void 0;
const filters_js_1 = require("../../filters/filters.js");
Object.defineProperty(exports, "isWebGLAvailable", { enumerable: true, get: function () { return filters_js_1.isWebGLAvailable; } });
Object.defineProperty(exports, "disposeWebGL", { enumerable: true, get: function () { return filters_js_1.disposeWebGL; } });
Object.defineProperty(exports, "disposeWebGPU", { enumerable: true, get: function () { return filters_js_1.disposeWebGPU; } });
const cpu_js_1 = require("../../filters/cpu.js");
/**
 * Edge-preserving smoothing filter. Backend resolution and mid-session
 * fallback are handled entirely by the underlying
 * `BilateralEdgeAwareFilter`; this class just remembers the config.
 */
class BilateralFilter {
    filter;
    config;
    constructor(filter, config) {
        this.filter = filter;
        this.config = config;
    }
    static async create(config = {}, options) {
        const filter = await filters_js_1.BilateralFilter.create(config, options);
        return new BilateralFilter(filter, config);
    }
    get backend() {
        return this.filter.backend;
    }
    dispose() {
        this.filter.dispose();
    }
    async process(input) {
        return this.filter.apply(input, this.config);
    }
}
exports.BilateralFilter = BilateralFilter;
/**
 * Median filter for salt-and-pepper noise removal.
 */
class MedianFilter {
    filter;
    config;
    constructor(filter, config) {
        this.filter = filter;
        this.config = config;
    }
    static async create(config = {}, options) {
        const filter = await filters_js_1.MedianFilter.create(config, options);
        return new MedianFilter(filter, config);
    }
    get backend() {
        return this.filter.backend;
    }
    dispose() {
        this.filter.dispose();
    }
    async process(input) {
        return this.filter.apply(input, this.config);
    }
}
exports.MedianFilter = MedianFilter;
/**
 * Kuwahara filter for a painterly, stylized effect.
 */
class KuwaharaFilter {
    filter;
    config;
    constructor(filter, config) {
        this.filter = filter;
        this.config = config;
    }
    static async create(config = {}, options) {
        const filter = await filters_js_1.KuwaharaFilter.create(config, options);
        return new KuwaharaFilter(filter, config);
    }
    get backend() {
        return this.filter.backend;
    }
    dispose() {
        this.filter.dispose();
    }
    async process(input) {
        return this.filter.apply(input, this.config);
    }
}
exports.KuwaharaFilter = KuwaharaFilter;
/**
 * Separable Gaussian blur.
 */
class GaussianBlur {
    filter;
    config;
    constructor(filter, config) {
        this.filter = filter;
        this.config = config;
    }
    static async create(sigma = 1.0, options) {
        const config = { sigma };
        const filter = await filters_js_1.GaussianBlur.create(config, options);
        return new GaussianBlur(filter, config);
    }
    get backend() {
        return this.filter.backend;
    }
    dispose() {
        this.filter.dispose();
    }
    async process(input) {
        return this.filter.apply(input, this.config);
    }
}
exports.GaussianBlur = GaussianBlur;
/**
 * Black/white point contrast stretch.
 */
class ContrastEnhancer {
    filter;
    config;
    constructor(filter, config) {
        this.filter = filter;
        this.config = config;
    }
    static async create(blackPoint = 0.01, whitePoint = 0.99, options) {
        const filter = await filters_js_1.ContrastEnhancer.create(blackPoint, whitePoint, options);
        return new ContrastEnhancer(filter, { blackPoint, whitePoint });
    }
    get backend() {
        return this.filter.backend;
    }
    dispose() {
        this.filter.dispose();
    }
    async process(input) {
        return this.filter.apply(input, this.config);
    }
}
exports.ContrastEnhancer = ContrastEnhancer;
/**
 * Posterize/quantize intensity levels.
 */
class Quantizer {
    filter;
    config;
    constructor(filter, config) {
        this.filter = filter;
        this.config = config;
    }
    static async create(levels = 8, options) {
        const config = { levels };
        const filter = await filters_js_1.Quantizer.create(config, options);
        return new Quantizer(filter, config);
    }
    get backend() {
        return this.filter.backend;
    }
    dispose() {
        this.filter.dispose();
    }
    async process(input) {
        return this.filter.apply(input, this.config);
    }
}
exports.Quantizer = Quantizer;
class LocalVariance {
    filter;
    config;
    constructor(filter, config) {
        this.filter = filter;
        this.config = config;
    }
    static async create(config) {
        const filter = new cpu_js_1.LocalVarianceFilter();
        return new LocalVariance(filter, config);
    }
    get backend() {
        return this.filter.backend;
    }
    dispose() {
        this.filter.dispose();
    }
    async process(input) {
        return this.filter.apply(input, this.config);
    }
}
exports.LocalVariance = LocalVariance;
exports.PreprocessingPresets = {
    /**
     * Light preprocessing - minimal smoothing
     * Good for: Clean studio photos, illustrations
     */
    light: async (input) => {
        const filter = await BilateralFilter.create({ sigmaSpatial: 2, sigmaRange: 0.08 });
        try {
            return await filter.process(input);
        }
        finally {
            filter.dispose();
        }
    },
    /**
     * Standard preprocessing - balanced smoothing
     * Good for: Most outdoor photos, portraits
     */
    standard: async (input) => {
        const filter = await BilateralFilter.create({ sigmaSpatial: 4, sigmaRange: 0.1 });
        try {
            return await filter.process(input);
        }
        finally {
            filter.dispose();
        }
    },
    /**
     * Heavy preprocessing - aggressive noise removal
     * Good for: Very textured images (grass, foliage, fabric)
     */
    heavy: async (input) => {
        const first = await BilateralFilter.create({ sigmaSpatial: 5, sigmaRange: 0.12 });
        const second = await BilateralFilter.create({ sigmaSpatial: 3, sigmaRange: 0.1 });
        try {
            return await second.process(await first.process(input));
        }
        finally {
            first.dispose();
            second.dispose();
        }
    },
    /**
     * Artistic preprocessing - painterly smoothing
     * Good for: Stylized/artistic output
     */
    artistic: async (input) => {
        const kuwahara = await KuwaharaFilter.create({ radius: 4 });
        const bilateral = await BilateralFilter.create({ sigmaSpatial: 2, sigmaRange: 0.08 });
        try {
            return await bilateral.process(await kuwahara.process(input));
        }
        finally {
            kuwahara.dispose();
            bilateral.dispose();
        }
    },
    /**
     * Photo preprocessing - for photos with grass/nature
     * Good for: Landscape, outdoor scenes
     */
    nature: async (input) => {
        const first = await BilateralFilter.create({ sigmaSpatial: 6, sigmaRange: 0.15 });
        const second = await BilateralFilter.create({ sigmaSpatial: 3, sigmaRange: 0.08 });
        try {
            return await second.process(await first.process(input));
        }
        finally {
            first.dispose();
            second.dispose();
        }
    },
};
class PreprocessingPipeline {
    options;
    operations = [];
    constructor(options) {
        this.options = options;
    }
    async bilateral(config) {
        this.operations.push(await BilateralFilter.create(config, this.options));
        return this;
    }
    async median(config) {
        this.operations.push(await MedianFilter.create(config, this.options));
        return this;
    }
    async kuwahara(config) {
        this.operations.push(await KuwaharaFilter.create(config, this.options));
        return this;
    }
    async gaussian(sigma) {
        this.operations.push(await GaussianBlur.create(sigma, this.options));
        return this;
    }
    async contrast(blackPoint, whitePoint) {
        this.operations.push(await ContrastEnhancer.create(blackPoint, whitePoint, this.options));
        return this;
    }
    async quantize(levels) {
        this.operations.push(await Quantizer.create(levels, this.options));
        return this;
    }
    /**
     * Add an arbitrary custom preprocessing strategy to the pipeline.
     * Bring your own backend selection if needed.
     */
    use(preprocessor) {
        this.operations.push(preprocessor);
        return this;
    }
    async apply(input) {
        let result = input;
        for (const op of this.operations) {
            result = await op.process(result);
            op.dispose();
        }
        return result;
    }
    /** Disposes every staged operation's resources and clears the pipeline. */
    clear() {
        for (const op of this.operations)
            op.dispose();
        this.operations = [];
        return this;
    }
}
exports.PreprocessingPipeline = PreprocessingPipeline;
//# sourceMappingURL=index.js.map