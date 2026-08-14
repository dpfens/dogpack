"use strict";
/**
 * Composed Preprocessing Module for XDoG/FDoG
 *
 * This module is the single entry point the rest of the codebase should
 * import from. Each exported class resolves its OWN best-supported
 * backend independently (WebGPU > WebGL > CPU), the first time it's
 * created:
 *
 *   BilateralFilter.create(...)  // may end up WebGPU on this device
 *   MedianFilter.create(...)     // may end up WebGL on this device, if
 *                                // e.g. it needs a storage texture format
 *                                // WebGPU can't provide here
 *
 * A device can support WebGPU for one algorithm and not another, so
 * resolution happens per class, not once globally for the whole module.
 * This follows the same pattern used for BlurStrategy/ETFComputer.
 *
 * If a backend fails mid-session (driver crash, lost context), each
 * instance demotes itself to the next supported candidate once and
 * retries the call that failed; that shared retry/demote machinery lives
 * in `ResilientPreprocessor`, not duplicated per filter.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.disposeWebGPU = exports.disposeWebGL = exports.isWebGLAvailable = exports.PreprocessingPipeline = exports.PreprocessingPresets = exports.Quantizer = exports.ContrastEnhancer = exports.GaussianBlur = exports.KuwaharaFilter = exports.MedianFilter = exports.BilateralFilter = void 0;
const resilient_preprocessor_js_1 = require("./resilient-preprocessor.js");
const webgl_js_1 = require("./webgl.js");
Object.defineProperty(exports, "isWebGLAvailable", { enumerable: true, get: function () { return webgl_js_1.isWebGLAvailable; } });
Object.defineProperty(exports, "disposeWebGL", { enumerable: true, get: function () { return webgl_js_1.disposeWebGL; } });
const webgpu_js_1 = require("./webgpu.js");
Object.defineProperty(exports, "disposeWebGPU", { enumerable: true, get: function () { return webgpu_js_1.disposeWebGPU; } });
const cpu_js_1 = require("./cpu.js");
function pickCandidates(candidates, options) {
    if (!options?.forceCPU)
        return candidates;
    return [candidates[candidates.length - 1]];
}
/**
 * Edge-preserving smoothing filter. Resolves the best supported backend
 * at creation time; falls back once if that backend fails later.
 */
class BilateralFilter extends resilient_preprocessor_js_1.ResilientPreprocessor {
    // Ordered best-to-worst. `satisfies` (not `implements`) catches a
    // backend missing isSupported() or the instance shape at this line.
    static candidates = [
        webgpu_js_1.GPUBilateralFilter,
        webgl_js_1.BilateralFilterWebGL,
        cpu_js_1.BilateralFilter,
    ];
    constructor(resolved, config) {
        super(BilateralFilter.candidates, resolved, config);
    }
    static async create(config = {}, options) {
        const resolved = await resilient_preprocessor_js_1.ResilientPreprocessor.resolve(pickCandidates(BilateralFilter.candidates, options), config);
        return new BilateralFilter(resolved, config);
    }
}
exports.BilateralFilter = BilateralFilter;
/**
 * Median filter for salt-and-pepper noise removal.
 */
class MedianFilter extends resilient_preprocessor_js_1.ResilientPreprocessor {
    static candidates = [
        webgpu_js_1.GPUMedianFilter,
        webgl_js_1.MedianFilterWebGL,
        cpu_js_1.MedianFilter,
    ];
    constructor(resolved, config) {
        super(MedianFilter.candidates, resolved, config);
    }
    static async create(config = {}, options) {
        const resolved = await resilient_preprocessor_js_1.ResilientPreprocessor.resolve(pickCandidates(MedianFilter.candidates, options), config);
        return new MedianFilter(resolved, config);
    }
}
exports.MedianFilter = MedianFilter;
/**
 * Kuwahara filter for a painterly, stylized effect.
 */
class KuwaharaFilter extends resilient_preprocessor_js_1.ResilientPreprocessor {
    static candidates = [
        webgpu_js_1.GPUKuwaharaFilter,
        webgl_js_1.KuwaharaFilterWebGL,
        cpu_js_1.KuwaharaFilter,
    ];
    constructor(resolved, config) {
        super(KuwaharaFilter.candidates, resolved, config);
    }
    static async create(config = {}, options) {
        const resolved = await resilient_preprocessor_js_1.ResilientPreprocessor.resolve(pickCandidates(KuwaharaFilter.candidates, options), config);
        return new KuwaharaFilter(resolved, config);
    }
}
exports.KuwaharaFilter = KuwaharaFilter;
/**
 * Separable Gaussian blur.
 */
class GaussianBlur extends resilient_preprocessor_js_1.ResilientPreprocessor {
    static candidates = [
        webgpu_js_1.GPUGaussianBlur,
        webgl_js_1.GaussianBlurWebGL,
        cpu_js_1.GaussianBlur,
    ];
    constructor(resolved, sigma) {
        super(GaussianBlur.candidates, resolved, sigma);
    }
    static async create(sigma = 1.0, options) {
        const resolved = await resilient_preprocessor_js_1.ResilientPreprocessor.resolve(pickCandidates(GaussianBlur.candidates, options), sigma);
        return new GaussianBlur(resolved, sigma);
    }
}
exports.GaussianBlur = GaussianBlur;
function adaptContrastCtor(Ctor) {
    const Adapted = class {
        static isSupported = Ctor.isSupported;
        static getUnsupportedReason = Ctor.getUnsupportedReason;
        constructor(config) {
            return new Ctor(config.blackPoint, config.whitePoint);
        }
    };
    return Adapted;
}
class ContrastEnhancer extends resilient_preprocessor_js_1.ResilientPreprocessor {
    static candidates = [
        adaptContrastCtor(webgpu_js_1.GPUContrastEnhancer),
        adaptContrastCtor(webgl_js_1.ContrastEnhancerWebGL),
        adaptContrastCtor(cpu_js_1.ContrastEnhancer),
    ];
    constructor(resolved, config) {
        super(ContrastEnhancer.candidates, resolved, config);
    }
    static async create(blackPoint = 0.01, whitePoint = 0.99, options) {
        const config = { blackPoint, whitePoint };
        const resolved = await resilient_preprocessor_js_1.ResilientPreprocessor.resolve(pickCandidates(ContrastEnhancer.candidates, options), config);
        return new ContrastEnhancer(resolved, config);
    }
}
exports.ContrastEnhancer = ContrastEnhancer;
/**
 * Posterize/quantize intensity levels.
 */
class Quantizer extends resilient_preprocessor_js_1.ResilientPreprocessor {
    static candidates = [
        webgpu_js_1.GPUQuantizer,
        webgl_js_1.QuantizerWebGL,
        cpu_js_1.Quantizer,
    ];
    constructor(resolved, levels) {
        super(Quantizer.candidates, resolved, levels);
    }
    static async create(levels = 8, options) {
        const resolved = await resilient_preprocessor_js_1.ResilientPreprocessor.resolve(pickCandidates(Quantizer.candidates, options), levels);
        return new Quantizer(resolved, levels);
    }
}
exports.Quantizer = Quantizer;
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
//# sourceMappingURL=preprocessor.js.map