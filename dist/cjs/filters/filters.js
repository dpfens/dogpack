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
 * in `ResilientEdgeAwareFilter`, not duplicated per filter.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.disposeWebGPU = exports.disposeWebGL = exports.isWebGLAvailable = exports.PreprocessingPresets = exports.Quantizer = exports.ContrastEnhancer = exports.GaussianBlur = exports.IsotropicBlurFilter = exports.KuwaharaFilter = exports.MedianFilter = exports.BilateralFilter = void 0;
const resilient_filter_js_1 = require("./resilient-filter.js");
const webgl_js_1 = require("./webgl.js");
Object.defineProperty(exports, "isWebGLAvailable", { enumerable: true, get: function () { return webgl_js_1.isWebGLAvailable; } });
Object.defineProperty(exports, "disposeWebGL", { enumerable: true, get: function () { return webgl_js_1.disposeWebGL; } });
const webgpu_js_1 = require("./webgpu.js");
Object.defineProperty(exports, "disposeWebGPU", { enumerable: true, get: function () { return webgpu_js_1.disposeWebGPU; } });
const cpu_js_1 = require("./cpu.js");
const webgpu_js_2 = require("./isotropic/webgpu.js");
const webgl_js_2 = require("./isotropic/webgl.js");
const cpu_js_2 = require("./isotropic/cpu.js");
function pickCandidates(candidates, options) {
    if (!options?.forceCPU)
        return candidates;
    return [candidates[candidates.length - 1]];
}
/**
 * Edge-preserving smoothing filter. Resolves the best supported backend
 * at creation time; falls back once if that backend fails later.
 */
class BilateralFilter extends resilient_filter_js_1.ResilientEdgeAwareFilter {
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
        const resolved = await resilient_filter_js_1.ResilientEdgeAwareFilter.resolve(pickCandidates(BilateralFilter.candidates, options), config);
        return new BilateralFilter(resolved, config);
    }
}
exports.BilateralFilter = BilateralFilter;
/**
 * Median filter for salt-and-pepper noise removal.
 */
class MedianFilter extends resilient_filter_js_1.ResilientEdgeAwareFilter {
    static candidates = [
        webgpu_js_1.GPUMedianFilter,
        webgl_js_1.MedianFilterWebGL,
        cpu_js_1.MedianFilter,
    ];
    constructor(resolved, config) {
        super(MedianFilter.candidates, resolved, config);
    }
    static async create(config = {}, options) {
        const resolved = await resilient_filter_js_1.ResilientEdgeAwareFilter.resolve(pickCandidates(MedianFilter.candidates, options), config);
        return new MedianFilter(resolved, config);
    }
}
exports.MedianFilter = MedianFilter;
/**
 * Kuwahara filter for a painterly, stylized effect.
 */
class KuwaharaFilter extends resilient_filter_js_1.ResilientEdgeAwareFilter {
    static candidates = [
        webgpu_js_1.GPUKuwaharaFilter,
        webgl_js_1.KuwaharaFilterWebGL,
        cpu_js_1.KuwaharaFilter,
    ];
    constructor(resolved, config) {
        super(KuwaharaFilter.candidates, resolved, config);
    }
    static async create(config = {}, options) {
        const resolved = await resilient_filter_js_1.ResilientEdgeAwareFilter.resolve(pickCandidates(KuwaharaFilter.candidates, options), config);
        return new KuwaharaFilter(resolved, config);
    }
}
exports.KuwaharaFilter = KuwaharaFilter;
/**
 * Separable Isotropic blur.
 */
class IsotropicBlurFilter extends resilient_filter_js_1.ResilientEdgeAwareFilter {
    static candidates = [
        webgpu_js_2.WebGPUIsotropicFilter,
        webgl_js_2.WebGLIsotropicFilter,
        cpu_js_2.CPUIsotropicFilter,
    ];
    constructor(resolved, config) {
        super(IsotropicBlurFilter.candidates, resolved, config);
    }
    static async create(config, options) {
        const resolved = await resilient_filter_js_1.ResilientEdgeAwareFilter.resolve(pickCandidates(IsotropicBlurFilter.candidates, options), config);
        return new IsotropicBlurFilter(resolved, config);
    }
}
exports.IsotropicBlurFilter = IsotropicBlurFilter;
/**
 * Separable Gaussian blur.
 */
class GaussianBlur extends resilient_filter_js_1.ResilientEdgeAwareFilter {
    static candidates = [
        webgpu_js_1.GPUGaussianBlur,
        webgl_js_1.GaussianBlurWebGL,
        cpu_js_1.GaussianBlur,
    ];
    constructor(resolved, config) {
        super(GaussianBlur.candidates, resolved, config);
    }
    static async create(config, options) {
        const resolved = await resilient_filter_js_1.ResilientEdgeAwareFilter.resolve(pickCandidates(GaussianBlur.candidates, options), config);
        return new GaussianBlur(resolved, config);
    }
}
exports.GaussianBlur = GaussianBlur;
class ContrastEnhancer extends resilient_filter_js_1.ResilientEdgeAwareFilter {
    static candidates = [
        webgpu_js_1.GPUContrastEnhancer,
        webgl_js_1.ContrastEnhancerWebGL,
        cpu_js_1.ContrastEnhancer,
    ];
    constructor(resolved, config) {
        super(ContrastEnhancer.candidates, resolved, config);
    }
    static async create(blackPoint = 0.01, whitePoint = 0.99, options) {
        const config = { blackPoint, whitePoint };
        const resolved = await resilient_filter_js_1.ResilientEdgeAwareFilter.resolve(pickCandidates(ContrastEnhancer.candidates, options), config);
        return new ContrastEnhancer(resolved, config);
    }
}
exports.ContrastEnhancer = ContrastEnhancer;
/**
 * Posterize/quantize intensity levels.
 */
class Quantizer extends resilient_filter_js_1.ResilientEdgeAwareFilter {
    static candidates = [
        webgpu_js_1.GPUQuantizer,
        webgl_js_1.QuantizerWebGL,
        cpu_js_1.Quantizer,
    ];
    constructor(resolved, config) {
        super(Quantizer.candidates, resolved, config);
    }
    static async create(config, options) {
        const resolved = await resilient_filter_js_1.ResilientEdgeAwareFilter.resolve(pickCandidates(Quantizer.candidates, options), config);
        return new Quantizer(resolved, config);
    }
}
exports.Quantizer = Quantizer;
exports.PreprocessingPresets = {
    /**
     * Light preprocessing - minimal smoothing
     * Good for: Clean studio photos, illustrations
     */
    light: async (input) => {
        const filter = await BilateralFilter.create();
        try {
            return await filter.apply(input, { sigmaSpatial: 2, sigmaRange: 0.08 });
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
        const filter = await BilateralFilter.create();
        try {
            return await filter.apply(input, { sigmaSpatial: 4, sigmaRange: 0.1 });
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
        const first = await BilateralFilter.create();
        const second = await BilateralFilter.create();
        try {
            return await second.apply(await first.apply(input, { sigmaSpatial: 5, sigmaRange: 0.12 }), { sigmaSpatial: 3, sigmaRange: 0.1 });
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
        const kuwahara = await KuwaharaFilter.create();
        const bilateral = await BilateralFilter.create();
        try {
            return await bilateral.apply(await kuwahara.apply(input, { radius: 4 }), { sigmaSpatial: 2, sigmaRange: 0.08 });
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
        const first = await BilateralFilter.create();
        const second = await BilateralFilter.create();
        try {
            return await second.apply(await first.apply(input, { sigmaSpatial: 6, sigmaRange: 0.15 }), { sigmaSpatial: 3, sigmaRange: 0.08 });
        }
        finally {
            first.dispose();
            second.dispose();
        }
    },
};
//# sourceMappingURL=filters.js.map