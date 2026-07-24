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
 * resolution happens per class, not once globally for the whole module —
 * this follows the same pattern used for BlurStrategy/ETFComputer.
 *
 * If a backend fails mid-session (driver crash, lost context), each
 * instance demotes itself to the next supported candidate once and
 * retries the call that failed; that shared retry/demote machinery lives
 * in `ResilientPreprocessor`, not duplicated per filter.
 */
import { ResilientPreprocessor } from './resilient-preprocessor.js';
import { BilateralFilterWebGL, MedianFilterWebGL, KuwaharaFilterWebGL, GaussianBlurWebGL, ContrastEnhancerWebGL, QuantizerWebGL, isWebGLAvailable, disposeWebGL, } from './webgl.js';
import { GPUBilateralFilter, GPUMedianFilter, GPUKuwaharaFilter, GPUGaussianBlur, GPUContrastEnhancer, GPUQuantizer, disposeWebGPU, } from './webgpu.js';
import { BilateralFilter as BilateralFilterCPU, MedianFilter as MedianFilterCPU, KuwaharaFilter as KuwaharaFilterCPU, GaussianBlur as GaussianBlurCPU, ContrastEnhancer as ContrastEnhancerCPU, Quantizer as QuantizerCPU, } from './cpu.js';
function pickCandidates(candidates, options) {
    if (!options?.forceCPU)
        return candidates;
    return [candidates[candidates.length - 1]];
}
/**
 * Edge-preserving smoothing filter. Resolves the best supported backend
 * at creation time; falls back once if that backend fails later.
 */
export class BilateralFilter extends ResilientPreprocessor {
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
        const resolved = await ResilientPreprocessor.resolve(pickCandidates(BilateralFilter.candidates, options), config);
        return new BilateralFilter(resolved, config);
    }
}
/**
 * Median filter for salt-and-pepper noise removal.
 */
export class MedianFilter extends ResilientPreprocessor {
    static candidates = [
        GPUMedianFilter,
        MedianFilterWebGL,
        MedianFilterCPU,
    ];
    constructor(resolved, config) {
        super(MedianFilter.candidates, resolved, config);
    }
    static async create(config = {}, options) {
        const resolved = await ResilientPreprocessor.resolve(pickCandidates(MedianFilter.candidates, options), config);
        return new MedianFilter(resolved, config);
    }
}
/**
 * Kuwahara filter for a painterly, stylized effect.
 */
export class KuwaharaFilter extends ResilientPreprocessor {
    static candidates = [
        GPUKuwaharaFilter,
        KuwaharaFilterWebGL,
        KuwaharaFilterCPU,
    ];
    constructor(resolved, config) {
        super(KuwaharaFilter.candidates, resolved, config);
    }
    static async create(config = {}, options) {
        const resolved = await ResilientPreprocessor.resolve(pickCandidates(KuwaharaFilter.candidates, options), config);
        return new KuwaharaFilter(resolved, config);
    }
}
/**
 * Separable Gaussian blur.
 *
 * Config here is just `number` (sigma), not an object — candidates'
 * constructors all take `(sigma: number)` directly, so `TConfig` is
 * `number` rather than a `Partial<...>` shape.
 */
export class GaussianBlur extends ResilientPreprocessor {
    static candidates = [
        GPUGaussianBlur,
        GaussianBlurWebGL,
        GaussianBlurCPU,
    ];
    constructor(resolved, sigma) {
        super(GaussianBlur.candidates, resolved, sigma);
    }
    static async create(sigma = 1.0, options) {
        const resolved = await ResilientPreprocessor.resolve(pickCandidates(GaussianBlur.candidates, options), sigma);
        return new GaussianBlur(resolved, sigma);
    }
}
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
export class ContrastEnhancer extends ResilientPreprocessor {
    static candidates = [
        adaptContrastCtor(GPUContrastEnhancer),
        adaptContrastCtor(ContrastEnhancerWebGL),
        adaptContrastCtor(ContrastEnhancerCPU),
    ];
    constructor(resolved, config) {
        super(ContrastEnhancer.candidates, resolved, config);
    }
    static async create(blackPoint = 0.01, whitePoint = 0.99, options) {
        const config = { blackPoint, whitePoint };
        const resolved = await ResilientPreprocessor.resolve(pickCandidates(ContrastEnhancer.candidates, options), config);
        return new ContrastEnhancer(resolved, config);
    }
}
/**
 * Posterize/quantize intensity levels.
 */
export class Quantizer extends ResilientPreprocessor {
    static candidates = [
        GPUQuantizer,
        QuantizerWebGL,
        QuantizerCPU,
    ];
    constructor(resolved, levels) {
        super(Quantizer.candidates, resolved, levels);
    }
    static async create(levels = 8, options) {
        const resolved = await ResilientPreprocessor.resolve(pickCandidates(Quantizer.candidates, options), levels);
        return new Quantizer(resolved, levels);
    }
}
export const PreprocessingPresets = {
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
export class PreprocessingPipeline {
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
export { isWebGLAvailable, disposeWebGL, disposeWebGPU };
//# sourceMappingURL=preprocessor.js.map