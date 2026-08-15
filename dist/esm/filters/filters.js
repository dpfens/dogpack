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
import { ResilientEdgeAwareFilter } from './resilient-filter.js';
import { BilateralFilterWebGL, MedianFilterWebGL, KuwaharaFilterWebGL, GaussianBlurWebGL, ContrastEnhancerWebGL, QuantizerWebGL, isWebGLAvailable, disposeWebGL, } from './webgl.js';
import { GPUBilateralFilter, GPUMedianFilter, GPUKuwaharaFilter, GPUGaussianBlur, GPUContrastEnhancer, GPUQuantizer, disposeWebGPU, } from './webgpu.js';
import { BilateralFilter as BilateralFilterCPU, MedianFilter as MedianFilterCPU, KuwaharaFilter as KuwaharaFilterCPU, GaussianBlur as GaussianBlurCPU, ContrastEnhancer as ContrastEnhancerCPU, Quantizer as QuantizerCPU, } from './cpu.js';
import { WebGPUIsotropicFilter } from './isotropic/webgpu.js';
import { WebGLIsotropicFilter } from './isotropic/webgl.js';
import { CPUIsotropicFilter } from './isotropic/cpu.js';
function pickCandidates(candidates, options) {
    if (!options?.forceCPU)
        return candidates;
    return [candidates[candidates.length - 1]];
}
/**
 * Edge-preserving smoothing filter. Resolves the best supported backend
 * at creation time; falls back once if that backend fails later.
 */
export class BilateralFilter extends ResilientEdgeAwareFilter {
    // Ordered best-to-worst. `satisfies` (not `implements`) catches a
    // backend missing isSupported() or the instance shape at this line.
    static candidates = [
        GPUBilateralFilter,
        BilateralFilterWebGL,
        BilateralFilterCPU,
    ];
    constructor(resolved, config) {
        super(BilateralFilter.candidates, resolved, config);
    }
    static async create(config = {}, options) {
        const resolved = await ResilientEdgeAwareFilter.resolve(pickCandidates(BilateralFilter.candidates, options), config);
        return new BilateralFilter(resolved, config);
    }
}
/**
 * Median filter for salt-and-pepper noise removal.
 */
export class MedianFilter extends ResilientEdgeAwareFilter {
    static candidates = [
        GPUMedianFilter,
        MedianFilterWebGL,
        MedianFilterCPU,
    ];
    constructor(resolved, config) {
        super(MedianFilter.candidates, resolved, config);
    }
    static async create(config = {}, options) {
        const resolved = await ResilientEdgeAwareFilter.resolve(pickCandidates(MedianFilter.candidates, options), config);
        return new MedianFilter(resolved, config);
    }
}
/**
 * Kuwahara filter for a painterly, stylized effect.
 */
export class KuwaharaFilter extends ResilientEdgeAwareFilter {
    static candidates = [
        GPUKuwaharaFilter,
        KuwaharaFilterWebGL,
        KuwaharaFilterCPU,
    ];
    constructor(resolved, config) {
        super(KuwaharaFilter.candidates, resolved, config);
    }
    static async create(config = {}, options) {
        const resolved = await ResilientEdgeAwareFilter.resolve(pickCandidates(KuwaharaFilter.candidates, options), config);
        return new KuwaharaFilter(resolved, config);
    }
}
/**
 * Separable Isotropic blur.
 */
export class IsotropicBlurFilter extends ResilientEdgeAwareFilter {
    static candidates = [
        WebGPUIsotropicFilter,
        WebGLIsotropicFilter,
        CPUIsotropicFilter,
    ];
    constructor(resolved, config) {
        super(IsotropicBlurFilter.candidates, resolved, config);
    }
    static async create(config, options) {
        const resolved = await ResilientEdgeAwareFilter.resolve(pickCandidates(IsotropicBlurFilter.candidates, options), config);
        return new IsotropicBlurFilter(resolved, config);
    }
}
/**
 * Separable Gaussian blur.
 */
export class GaussianBlur extends ResilientEdgeAwareFilter {
    static candidates = [
        GPUGaussianBlur,
        GaussianBlurWebGL,
        GaussianBlurCPU,
    ];
    constructor(resolved, config) {
        super(GaussianBlur.candidates, resolved, config);
    }
    static async create(config, options) {
        const resolved = await ResilientEdgeAwareFilter.resolve(pickCandidates(GaussianBlur.candidates, options), config);
        return new GaussianBlur(resolved, config);
    }
}
export class ContrastEnhancer extends ResilientEdgeAwareFilter {
    static candidates = [
        GPUContrastEnhancer,
        ContrastEnhancerWebGL,
        ContrastEnhancerCPU,
    ];
    constructor(resolved, config) {
        super(ContrastEnhancer.candidates, resolved, config);
    }
    static async create(blackPoint = 0.01, whitePoint = 0.99, options) {
        const config = { blackPoint, whitePoint };
        const resolved = await ResilientEdgeAwareFilter.resolve(pickCandidates(ContrastEnhancer.candidates, options), config);
        return new ContrastEnhancer(resolved, config);
    }
}
/**
 * Posterize/quantize intensity levels.
 */
export class Quantizer extends ResilientEdgeAwareFilter {
    static candidates = [
        GPUQuantizer,
        QuantizerWebGL,
        QuantizerCPU,
    ];
    constructor(resolved, config) {
        super(Quantizer.candidates, resolved, config);
    }
    static async create(config, options) {
        const resolved = await ResilientEdgeAwareFilter.resolve(pickCandidates(Quantizer.candidates, options), config);
        return new Quantizer(resolved, config);
    }
}
export const PreprocessingPresets = {
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
export { isWebGLAvailable, disposeWebGL, disposeWebGPU };
//# sourceMappingURL=filters.js.map