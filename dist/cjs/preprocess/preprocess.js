"use strict";
/**
 * Composed Preprocessing Module for XDoG/FDoG
 *
 * This module is the single entry point the rest of the codebase should
 * import from. Each exported class picks its backend ONCE, at
 * construction time:
 *
 *   - WebGL 2.0 available  -> delegates to the GPU implementation (webgl.ts)
 *   - WebGL 2.0 unavailable -> delegates to the CPU implementation (cpu.ts)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.disposeWebGL = exports.isWebGLAvailable = exports.PreprocessingPipeline = exports.PreprocessingPresets = exports.Quantizer = exports.ContrastEnhancer = exports.GaussianBlur = exports.KuwaharaFilter = exports.MedianFilter = exports.BilateralFilter = void 0;
const webgl_js_1 = require("./webgl.js");
Object.defineProperty(exports, "isWebGLAvailable", { enumerable: true, get: function () { return webgl_js_1.isWebGLAvailable; } });
Object.defineProperty(exports, "disposeWebGL", { enumerable: true, get: function () { return webgl_js_1.disposeWebGL; } });
const cpu_js_1 = require("./cpu.js");
function useWebGL(options) {
    if (options?.forceCPU)
        return false;
    return (0, webgl_js_1.isWebGLAvailable)();
}
// ============================================================================
// Composed Filters
// ============================================================================
/**
 * Edge-preserving smoothing filter. Uses the GPU implementation when
 * available, otherwise falls back to the CPU implementation.
 */
class BilateralFilter {
    instance;
    constructor(config = {}, options) {
        this.instance = useWebGL(options)
            ? new webgl_js_1.BilateralFilterWebGL(config)
            : new cpu_js_1.BilateralFilter(config);
    }
    process(input) {
        return this.instance.process(input);
    }
}
exports.BilateralFilter = BilateralFilter;
/**
 * Median filter for salt-and-pepper noise removal.
 */
class MedianFilter {
    instance;
    constructor(config = {}, options) {
        this.instance = useWebGL(options)
            ? new webgl_js_1.MedianFilterWebGL(config)
            : new cpu_js_1.MedianFilter(config);
    }
    process(input) {
        return this.instance.process(input);
    }
}
exports.MedianFilter = MedianFilter;
/**
 * Kuwahara filter for a painterly, stylized effect.
 */
class KuwaharaFilter {
    instance;
    constructor(config = {}, options) {
        this.instance = useWebGL(options)
            ? new webgl_js_1.KuwaharaFilterWebGL(config)
            : new cpu_js_1.KuwaharaFilter(config);
    }
    process(input) {
        return this.instance.process(input);
    }
}
exports.KuwaharaFilter = KuwaharaFilter;
/**
 * Separable Gaussian blur.
 */
class GaussianBlur {
    instance;
    constructor(sigma = 1.0, options) {
        this.instance = useWebGL(options)
            ? new webgl_js_1.GaussianBlurWebGL(sigma)
            : new cpu_js_1.GaussianBlur(sigma);
    }
    process(input) {
        return this.instance.process(input);
    }
}
exports.GaussianBlur = GaussianBlur;
/**
 * Histogram-percentile contrast stretch.
 */
class ContrastEnhancer {
    instance;
    constructor(blackPoint = 0.01, whitePoint = 0.99, options) {
        this.instance = useWebGL(options)
            ? new webgl_js_1.ContrastEnhancerWebGL(blackPoint, whitePoint)
            : new cpu_js_1.ContrastEnhancer(blackPoint, whitePoint);
    }
    process(input) {
        return this.instance.process(input);
    }
}
exports.ContrastEnhancer = ContrastEnhancer;
/**
 * Posterize/quantize intensity levels.
 */
class Quantizer {
    instance;
    constructor(levels = 8, options) {
        this.instance = useWebGL(options)
            ? new webgl_js_1.QuantizerWebGL(levels)
            : new cpu_js_1.Quantizer(levels);
    }
    process(input) {
        return this.instance.process(input);
    }
}
exports.Quantizer = Quantizer;
// ============================================================================
// Presets
// ============================================================================
// Built on top of the composed filters above, so each preset automatically
// gets the GPU-when-available/CPU-otherwise behavior for free, with no
// duplicated branching logic.
exports.PreprocessingPresets = {
    /**
     * Light preprocessing - minimal smoothing
     * Good for: Clean studio photos, illustrations
     */
    light: (input) => {
        return new BilateralFilter({ sigmaSpatial: 2, sigmaRange: 0.08 }).process(input);
    },
    /**
     * Standard preprocessing - balanced smoothing
     * Good for: Most outdoor photos, portraits
     */
    standard: (input) => {
        return new BilateralFilter({ sigmaSpatial: 4, sigmaRange: 0.1 }).process(input);
    },
    /**
     * Heavy preprocessing - aggressive noise removal
     * Good for: Very textured images (grass, foliage, fabric)
     */
    heavy: (input) => {
        let result = new BilateralFilter({ sigmaSpatial: 5, sigmaRange: 0.12 }).process(input);
        result = new BilateralFilter({ sigmaSpatial: 3, sigmaRange: 0.1 }).process(result);
        return result;
    },
    /**
     * Artistic preprocessing - painterly smoothing
     * Good for: Stylized/artistic output
     */
    artistic: (input) => {
        let result = new KuwaharaFilter({ radius: 4 }).process(input);
        result = new BilateralFilter({ sigmaSpatial: 2, sigmaRange: 0.08 }).process(result);
        return result;
    },
    /**
     * Photo preprocessing - for photos with grass/nature
     * Good for: Landscape, outdoor scenes
     */
    nature: (input) => {
        let result = new BilateralFilter({ sigmaSpatial: 6, sigmaRange: 0.15 }).process(input);
        result = new BilateralFilter({ sigmaSpatial: 3, sigmaRange: 0.08 }).process(result);
        return result;
    },
};
// ============================================================================
// Pipeline (Fluent API)
// ============================================================================
/**
 * Convenience class for chaining preprocessing operations. Each stage picks
 * its backend (GPU vs CPU) independently at the time it's added, using
 * whatever `isWebGLAvailable()` reports at that moment.
 */
class PreprocessingPipeline {
    options;
    operations = [];
    constructor(options) {
        this.options = options;
    }
    bilateral(config) {
        this.operations.push(new BilateralFilter(config, this.options));
        return this;
    }
    median(config) {
        this.operations.push(new MedianFilter(config, this.options));
        return this;
    }
    kuwahara(config) {
        this.operations.push(new KuwaharaFilter(config, this.options));
        return this;
    }
    gaussian(sigma) {
        this.operations.push(new GaussianBlur(sigma, this.options));
        return this;
    }
    contrast(blackPoint, whitePoint) {
        this.operations.push(new ContrastEnhancer(blackPoint, whitePoint, this.options));
        return this;
    }
    quantize(levels) {
        this.operations.push(new Quantizer(levels, this.options));
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
    apply(input) {
        let result = input;
        for (const op of this.operations) {
            result = op.process(result);
        }
        return result;
    }
    clear() {
        this.operations = [];
        return this;
    }
}
exports.PreprocessingPipeline = PreprocessingPipeline;
//# sourceMappingURL=preprocess.js.map