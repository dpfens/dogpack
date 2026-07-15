"use strict";
/**
 * Preprocessing module for XDoG/FDoG
 *
 * Provides filters to prepare images before line detection.
 * These help reduce noise and texture while preserving important edges.
 *
 * Section 3.2 of the paper discusses the importance of bilateral
 * preprocessing for "indication" - attenuating weak edges while
 * preserving strong edges.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PreprocessingPipeline = exports.PreprocessingPresets = exports.Quantizer = exports.ContrastEnhancer = exports.GaussianBlur = exports.KuwaharaFilter = exports.MedianFilter = exports.BilateralFilter = void 0;
const index_js_1 = require("../utils/index.js");
const base_js_1 = require("../base.js");
const DEFAULT_BILATERAL_CONFIG = {
    sigmaSpatial: 3,
    sigmaRange: 0.1,
    radiusMultiplier: 2,
};
const DEFAULT_MEDIAN_CONFIG = {
    radius: 2,
};
const DEFAULT_KUWAHARA_CONFIG = {
    radius: 3,
};
/**
 * Bilateral Filter
 *
 * Edge-preserving smoothing filter that averages pixels based on both
 * spatial proximity AND intensity similarity. This smooths out texture
 * (like grass) while keeping strong edges (like the car outline) sharp.
 *
 * This is the recommended preprocessing for most images.
 *
 * As mentioned in Section 3.2, bilateral filtering can serve as a
 * "prioritization mechanism" for indication - attenuating weak edges
 * while supporting strong edges.
 *
 * CPU is always available (BaseCPUStrategy.isSupported() / dispose() /
 * backend all apply unchanged) — this is the universal fallback.
 */
class BilateralFilter extends base_js_1.BaseCPUStrategy {
    config;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_BILATERAL_CONFIG, ...config };
    }
    async process(input) {
        const cfg = this.config;
        const { width, height } = input;
        const output = (0, index_js_1.createChannelImage)(width, height);
        const radius = Math.ceil(cfg.sigmaSpatial * (cfg.radiusMultiplier ?? 2));
        const sigmaSpatial2 = 2 * cfg.sigmaSpatial * cfg.sigmaSpatial;
        const sigmaRange2 = 2 * cfg.sigmaRange * cfg.sigmaRange;
        // Precompute spatial weights
        const spatialWeights = [];
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const dist2 = dx * dx + dy * dy;
                spatialWeights.push(Math.exp(-dist2 / sigmaSpatial2));
            }
        }
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const centerValue = (0, index_js_1.getPixel)(input, x, y);
                let sum = 0;
                let weightSum = 0;
                let idx = 0;
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        const neighborValue = (0, index_js_1.getPixel)(input, nx, ny);
                        // Range weight based on intensity difference
                        const intensityDiff = neighborValue - centerValue;
                        const rangeWeight = Math.exp(-(intensityDiff * intensityDiff) / sigmaRange2);
                        // Combined weight
                        const weight = spatialWeights[idx] * rangeWeight;
                        sum += neighborValue * weight;
                        weightSum += weight;
                        idx++;
                    }
                }
                output.data[y * width + x] = weightSum > 0 ? sum / weightSum : centerValue;
            }
        }
        return output;
    }
}
exports.BilateralFilter = BilateralFilter;
/**
 * Median Filter
 *
 * Replaces each pixel with the median of its neighborhood.
 * Excellent for removing salt-and-pepper noise and small texture details.
 */
class MedianFilter extends base_js_1.BaseCPUStrategy {
    config;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_MEDIAN_CONFIG, ...config };
    }
    async process(input) {
        const { width, height } = input;
        const output = (0, index_js_1.createChannelImage)(width, height);
        const radius = this.config.radius;
        const kernelSize = (2 * radius + 1) * (2 * radius + 1);
        const values = new Array(kernelSize);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let idx = 0;
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        values[idx++] = (0, index_js_1.getPixel)(input, x + dx, y + dy);
                    }
                }
                // Sort and take median
                values.sort((a, b) => a - b);
                output.data[y * width + x] = values[Math.floor(kernelSize / 2)];
            }
        }
        return output;
    }
}
exports.MedianFilter = MedianFilter;
/**
 * Kuwahara Filter
 *
 * Artistic smoothing filter that creates a painterly effect.
 * Divides the neighborhood into 4 quadrants, finds the one with
 * lowest variance, and uses its mean. Creates flat regions with
 * preserved edges - great for a more stylized look.
 */
class KuwaharaFilter extends base_js_1.BaseCPUStrategy {
    config;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_KUWAHARA_CONFIG, ...config };
    }
    async process(input) {
        const { width, height } = input;
        const output = (0, index_js_1.createChannelImage)(width, height);
        const r = this.config.radius;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                // Four quadrants: top-left, top-right, bottom-left, bottom-right
                const quadrants = [
                    { startX: -r, endX: 0, startY: -r, endY: 0 },
                    { startX: 0, endX: r, startY: -r, endY: 0 },
                    { startX: -r, endX: 0, startY: 0, endY: r },
                    { startX: 0, endX: r, startY: 0, endY: r },
                ];
                let minVariance = Infinity;
                let bestMean = (0, index_js_1.getPixel)(input, x, y);
                for (const q of quadrants) {
                    let sum = 0;
                    let sumSq = 0;
                    let count = 0;
                    for (let dy = q.startY; dy <= q.endY; dy++) {
                        for (let dx = q.startX; dx <= q.endX; dx++) {
                            const val = (0, index_js_1.getPixel)(input, x + dx, y + dy);
                            sum += val;
                            sumSq += val * val;
                            count++;
                        }
                    }
                    const mean = sum / count;
                    const variance = (sumSq / count) - (mean * mean);
                    if (variance < minVariance) {
                        minVariance = variance;
                        bestMean = mean;
                    }
                }
                output.data[y * width + x] = bestMean;
            }
        }
        return output;
    }
}
exports.KuwaharaFilter = KuwaharaFilter;
/**
 * Gaussian Blur
 *
 * Simple Gaussian smoothing. Less edge-preserving than bilateral,
 * but faster. Good for very noisy images or when used with small sigma.
 */
class GaussianBlur extends base_js_1.BaseCPUStrategy {
    sigma;
    constructor(sigma = 1.0) {
        super();
        this.sigma = sigma;
    }
    async process(input) {
        const { width, height } = input;
        const sigma = this.sigma;
        if (sigma < 0.1) {
            return { data: new Float32Array(input.data), width, height };
        }
        const radius = Math.ceil(sigma * 3);
        const kernelSize = radius * 2 + 1;
        const kernel = (0, index_js_1.generateGaussianKernel)(sigma, kernelSize);
        // Horizontal pass
        const temp = (0, index_js_1.createChannelImage)(width, height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let val = 0;
                for (let k = 0; k < kernelSize; k++) {
                    val += (0, index_js_1.getPixel)(input, x + k - radius, y) * kernel[k];
                }
                temp.data[y * width + x] = val;
            }
        }
        // Vertical pass
        const output = (0, index_js_1.createChannelImage)(width, height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let val = 0;
                for (let k = 0; k < kernelSize; k++) {
                    val += (0, index_js_1.getPixel)(temp, x, y + k - radius) * kernel[k];
                }
                output.data[y * width + x] = val;
            }
        }
        return output;
    }
}
exports.GaussianBlur = GaussianBlur;
/**
 * Contrast Enhancement
 *
 * Stretches the histogram to use the full 0-1 range.
 * Can help make edges more distinct before processing.
 */
class ContrastEnhancer extends base_js_1.BaseCPUStrategy {
    blackPoint;
    whitePoint;
    constructor(blackPoint = 0.01, whitePoint = 0.99) {
        super();
        this.blackPoint = blackPoint;
        this.whitePoint = whitePoint;
    }
    async process(input) {
        const { width, height, data } = input;
        const output = (0, index_js_1.createChannelImage)(width, height);
        const size = width * height;
        // Find histogram percentiles
        const sorted = new Float32Array(data).sort();
        const minVal = sorted[Math.floor(size * this.blackPoint)];
        const maxVal = sorted[Math.floor(size * this.whitePoint)];
        const range = maxVal - minVal;
        if (range < 0.01) {
            return { data: new Float32Array(data), width, height };
        }
        for (let i = 0; i < size; i++) {
            output.data[i] = Math.max(0, Math.min(1, (data[i] - minVal) / range));
        }
        return output;
    }
}
exports.ContrastEnhancer = ContrastEnhancer;
/**
 * Quantize to reduce color levels
 *
 * Reduces the number of intensity levels, creating a posterized effect.
 * Can help reduce noise by grouping similar intensities together.
 */
class Quantizer extends base_js_1.BaseCPUStrategy {
    levels;
    constructor(levels = 8) {
        super();
        this.levels = levels;
    }
    async process(input) {
        const { width, height, data } = input;
        const output = (0, index_js_1.createChannelImage)(width, height);
        const size = width * height;
        const step = 1 / (this.levels - 1);
        for (let i = 0; i < size; i++) {
            output.data[i] = Math.round(data[i] / step) * step;
        }
        return output;
    }
}
exports.Quantizer = Quantizer;
/**
 * Preset preprocessing pipelines for common use cases
 */
exports.PreprocessingPresets = {
    /**
     * Light preprocessing - minimal smoothing
     * Good for: Clean studio photos, illustrations
     */
    light: async (input) => {
        return await new BilateralFilter({ sigmaSpatial: 2, sigmaRange: 0.08 }).process(input);
    },
    /**
     * Standard preprocessing - balanced smoothing
     * Good for: Most outdoor photos, portraits
     */
    standard: async (input) => {
        return new BilateralFilter({ sigmaSpatial: 4, sigmaRange: 0.1 }).process(input);
    },
    /**
     * Heavy preprocessing - aggressive noise removal
     * Good for: Very textured images (grass, foliage, fabric)
     */
    heavy: async (input) => {
        let result = await new BilateralFilter({ sigmaSpatial: 5, sigmaRange: 0.12 }).process(input);
        result = await new BilateralFilter({ sigmaSpatial: 3, sigmaRange: 0.1 }).process(result);
        return result;
    },
    /**
     * Artistic preprocessing - painterly smoothing
     * Good for: Stylized/artistic output
     */
    artistic: async (input) => {
        let result = await new KuwaharaFilter({ radius: 4 }).process(input);
        result = await new BilateralFilter({ sigmaSpatial: 2, sigmaRange: 0.08 }).process(result);
        return result;
    },
    /**
     * Photo preprocessing - for photos with grass/nature
     * Good for: Landscape, outdoor scenes
     */
    nature: async (input) => {
        // First pass: aggressive bilateral to smooth texture
        let result = await new BilateralFilter({ sigmaSpatial: 6, sigmaRange: 0.15 }).process(input);
        // Second pass: lighter bilateral to clean up
        result = await new BilateralFilter({ sigmaSpatial: 3, sigmaRange: 0.08 }).process(result);
        return result;
    },
};
/**
 * Convenience class for chaining preprocessing operations
 */
class PreprocessingPipeline {
    operations = [];
    /**
     * Add bilateral filter to the pipeline
     */
    bilateral(config) {
        this.operations.push(new BilateralFilter(config));
        return this;
    }
    /**
     * Add median filter to the pipeline
     */
    median(config) {
        this.operations.push(new MedianFilter(config));
        return this;
    }
    /**
     * Add Kuwahara filter to the pipeline
     */
    kuwahara(config) {
        this.operations.push(new KuwaharaFilter(config));
        return this;
    }
    /**
     * Add Gaussian blur to the pipeline
     */
    gaussian(sigma) {
        this.operations.push(new GaussianBlur(sigma));
        return this;
    }
    /**
     * Add contrast enhancement to the pipeline
     */
    contrast(blackPoint, whitePoint) {
        this.operations.push(new ContrastEnhancer(blackPoint, whitePoint));
        return this;
    }
    /**
     * Add quantization to the pipeline
     */
    quantize(levels) {
        this.operations.push(new Quantizer(levels));
        return this;
    }
    /**
     * Add an arbitrary custom preprocessing strategy to the pipeline
     */
    use(preprocessor) {
        this.operations.push(preprocessor);
        return this;
    }
    /**
     * Apply all operations in sequence
     */
    async apply(input) {
        let result = input;
        for (const op of this.operations) {
            result = await op.process(result);
        }
        return result;
    }
    /**
     * Clear all operations
     */
    clear() {
        this.operations = [];
        return this;
    }
}
exports.PreprocessingPipeline = PreprocessingPipeline;
//# sourceMappingURL=cpu.js.map