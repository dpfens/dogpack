"use strict";
/**
 * Multi-Scale Strategy Types and Implementation
 *
 * Refactored to use function-based blending, allowing users to either:
 * 1. Use the provided blend functions (average, min, max, multiply)
 * 2. Supply their own custom blend function
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiScaleStrategy = exports.BlendFunctions = exports.blendPriority = exports.blendDifference = exports.blendSoftMax = exports.blendSoftMin = exports.blendMedian = exports.blendHarmonicMean = exports.blendGeometricMean = exports.blendOverlay = exports.blendSoftLight = exports.blendScreen = exports.blendMultiply = exports.blendMax = exports.blendMin = exports.blendAverage = void 0;
exports.createPercentileBlend = createPercentileBlend;
exports.createMixedBlend = createMixedBlend;
exports.createGammaCorrectedBlend = createGammaCorrectedBlend;
const index_js_1 = require("../dog/index.js");
const index_js_2 = require("../utils/index.js");
// =============================================================================
// Built-in Blend Functions
// =============================================================================
/**
 * Weighted average blend - smoothly combines all layers
 *
 * Best for: Balanced multi-scale results, general purpose
 */
const blendAverage = (ctx) => {
    let sum = 0;
    for (let i = 0; i < ctx.values.length; i++) {
        sum += ctx.values[i] * ctx.weights[i];
    }
    return sum;
};
exports.blendAverage = blendAverage;
/**
 * Minimum blend - takes the darkest value at each pixel
 *
 * Best for: Preserving fine details, ensuring all edges are captured
 * Since edges are dark (0) on white (1), min keeps all detected edges
 */
const blendMin = (ctx) => {
    let min = 1;
    for (const value of ctx.values) {
        if (value < min)
            min = value;
    }
    return min;
};
exports.blendMin = blendMin;
/**
 * Maximum blend - takes the brightest value at each pixel
 *
 * Best for: Abstract styles where only strong edges should appear
 * Removes edges that don't appear in all scales
 */
const blendMax = (ctx) => {
    let max = 0;
    for (const value of ctx.values) {
        if (value > max)
            max = value;
    }
    return max;
};
exports.blendMax = blendMax;
/**
 * Multiply blend - multiplies all layer values together
 *
 * Best for: Strong edge emphasis, high contrast results
 * Areas that are dark in any layer become very dark
 */
const blendMultiply = (ctx) => {
    let product = 1;
    for (const value of ctx.values) {
        product *= value;
    }
    return product;
};
exports.blendMultiply = blendMultiply;
/**
 * Screen blend - inverse of multiply, brightens the result
 *
 * Best for: Lighter, more ethereal line drawings
 */
const blendScreen = (ctx) => {
    let product = 1;
    for (const value of ctx.values) {
        product *= (1 - value);
    }
    return 1 - product;
};
exports.blendScreen = blendScreen;
/**
 * Soft light blend - subtle contrast enhancement
 *
 * Best for: Natural-looking multi-scale combination
 */
const blendSoftLight = (ctx) => {
    // Use weighted average as base, then apply soft light formula
    let base = 0;
    for (let i = 0; i < ctx.values.length; i++) {
        base += ctx.values[i] * ctx.weights[i];
    }
    // Apply soft light with first layer as blend layer
    const blend = ctx.values[0];
    if (blend <= 0.5) {
        return base - (1 - 2 * blend) * base * (1 - base);
    }
    else {
        const d = base <= 0.25
            ? ((16 * base - 12) * base + 4) * base
            : Math.sqrt(base);
        return base + (2 * blend - 1) * (d - base);
    }
};
exports.blendSoftLight = blendSoftLight;
/**
 * Overlay blend - combines multiply and screen based on base value
 *
 * Best for: High contrast results that preserve both highlights and shadows
 */
const blendOverlay = (ctx) => {
    // Use weighted average as base
    let base = 0;
    for (let i = 0; i < ctx.values.length; i++) {
        base += ctx.values[i] * ctx.weights[i];
    }
    // Overlay formula: multiply darks, screen lights
    if (base < 0.5) {
        let product = 1;
        for (const value of ctx.values) {
            product *= value;
        }
        return 2 * product;
    }
    else {
        let product = 1;
        for (const value of ctx.values) {
            product *= (1 - value);
        }
        return 1 - 2 * product;
    }
};
exports.blendOverlay = blendOverlay;
/**
 * Geometric mean blend - multiplicative average, less extreme than multiply
 *
 * Best for: Balanced darkening that respects layer weights
 */
const blendGeometricMean = (ctx) => {
    let logSum = 0;
    for (let i = 0; i < ctx.values.length; i++) {
        // Add small epsilon to avoid log(0)
        logSum += ctx.weights[i] * Math.log(ctx.values[i] + 1e-6);
    }
    return Math.exp(logSum);
};
exports.blendGeometricMean = blendGeometricMean;
/**
 * Harmonic mean blend - emphasizes smaller values more than arithmetic mean
 *
 * Best for: Preserving fine details while still allowing averaging
 */
const blendHarmonicMean = (ctx) => {
    let reciprocalSum = 0;
    for (let i = 0; i < ctx.values.length; i++) {
        // Add small epsilon to avoid division by zero
        reciprocalSum += ctx.weights[i] / (ctx.values[i] + 1e-6);
    }
    return 1 / reciprocalSum;
};
exports.blendHarmonicMean = blendHarmonicMean;
/**
 * Median blend - selects the middle value, robust to outliers
 *
 * Best for: Noise-resistant combination when layer count is odd
 */
const blendMedian = (ctx) => {
    const sorted = [...ctx.values].sort((a, b) => a - b);
    const mid = sorted.length / 2;
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[Math.floor(mid)];
};
exports.blendMedian = blendMedian;
/**
 * Soft min blend - smooth approximation of minimum using log-sum-exp
 *
 * Best for: Capturing all edges with smoother transitions than hard min
 */
const blendSoftMin = (ctx) => {
    const k = 8; // Sharpness: higher = closer to true min
    let sumExp = 0;
    for (const value of ctx.values) {
        sumExp += Math.exp(-k * value);
    }
    return -Math.log(sumExp / ctx.values.length) / k;
};
exports.blendSoftMin = blendSoftMin;
/**
 * Soft max blend - smooth approximation of maximum using log-sum-exp
 *
 * Best for: Selecting dominant edges with smoother transitions than hard max
 */
const blendSoftMax = (ctx) => {
    const k = 8; // Sharpness: higher = closer to true max
    let sumExp = 0;
    for (const value of ctx.values) {
        sumExp += Math.exp(k * value);
    }
    return Math.log(sumExp / ctx.values.length) / k;
};
exports.blendSoftMax = blendSoftMax;
/**
 * Difference blend - absolute difference between layers (best with 2 layers)
 *
 * Best for: Highlighting scale-dependent features, edge comparison
 */
const blendDifference = (ctx) => {
    if (ctx.values.length === 2) {
        return Math.abs(ctx.values[0] - ctx.values[1]);
    }
    // For multiple layers, compute max difference from weighted average
    let avg = 0;
    for (let i = 0; i < ctx.values.length; i++) {
        avg += ctx.values[i] * ctx.weights[i];
    }
    let maxDiff = 0;
    for (const value of ctx.values) {
        maxDiff = Math.max(maxDiff, Math.abs(value - avg));
    }
    return maxDiff;
};
exports.blendDifference = blendDifference;
/**
 * Priority blend - uses fine scale unless coarse scale has strong edges
 *
 * Best for: Detail preservation with fallback to coarse structure
 * Assumes layers ordered fine-to-coarse (first = finest detail)
 */
const blendPriority = (ctx) => {
    // Start with finest layer
    let result = ctx.values[0];
    // Let coarser layers "vote" to override when they have strong edges (dark values)
    for (let i = 1; i < ctx.values.length; i++) {
        const coarseEdgeStrength = 1 - ctx.values[i]; // Invert: dark = strong edge
        // Blend toward coarse value when it has strong edges
        result = result * (1 - coarseEdgeStrength * 0.5) + ctx.values[i] * (coarseEdgeStrength * 0.5);
    }
    return result;
};
exports.blendPriority = blendPriority;
/**
 * Collection of all built-in blend functions for easy access
 */
exports.BlendFunctions = {
    average: exports.blendAverage,
    min: exports.blendMin,
    max: exports.blendMax,
    multiply: exports.blendMultiply,
    screen: exports.blendScreen,
    softLight: exports.blendSoftLight,
    overlay: exports.blendOverlay,
    geometricMean: exports.blendGeometricMean,
    harmonicMean: exports.blendHarmonicMean,
    median: exports.blendMedian,
    softMin: exports.blendSoftMin,
    softMax: exports.blendSoftMax,
    difference: exports.blendDifference,
    priority: exports.blendPriority,
};
// =============================================================================
// Multi-Scale Strategy Implementation
// =============================================================================
/**
 * Multi-Scale Strategy
 *
 * Combines XDoG/FDoG results at different scales for scale-space
 * edge detection. Accepts pre-configured processor instances, giving
 * developers full control over each layer's configuration.
 *
 * From Section 3.1 (Abstraction): Different σ values capture different
 * levels of detail.
 *
 * @example Using built-in blend function
 * ```typescript
 * const multiScale = new MultiScaleStrategy({
 *   layers: [
 *     { processor: new XDoG({ sigma: 0.5, p: 30 }), weight: 1 },
 *     { processor: new FDoG({ sigma: 2.0, sigmaM: 4.0 }), weight: 2 },
 *   ],
 *   blend: BlendFunctions.min,
 * });
 * const result = await multiScale.apply(input);
 * ```
 *
 * @example Using custom blend function
 * ```typescript
 * const multiScale = new MultiScaleStrategy({
 *   layers: [
 *     { processor: new XDoG({ sigma: 0.4, p: 20 }), weight: 2 },
 *     { processor: new FDoG({ sigma: 1.6, sigmaM: 4.0 }), weight: 1 },
 *   ],
 *   blend: (ctx) => {
 *     // Weighted geometric mean
 *     let logSum = 0;
 *     for (let i = 0; i < ctx.values.length; i++) {
 *       logSum += ctx.weights[i] * Math.log(ctx.values[i] + 0.001);
 *     }
 *     return Math.exp(logSum);
 *   },
 * });
 * ```
 *
 * @example Position-dependent blending
 * ```typescript
 * const vignetteBlend: BlendFunction = (ctx) => {
 *   // Use fine details in center, coarse at edges
 *   const cx = ctx.width / 2, cy = ctx.height / 2;
 *   const dist = Math.sqrt((ctx.x - cx) ** 2 + (ctx.y - cy) ** 2);
 *   const maxDist = Math.sqrt(cx ** 2 + cy ** 2);
 *   const t = dist / maxDist; // 0 at center, 1 at corners
 *
 *   // Interpolate between first layer (fine) and last layer (coarse)
 *   return ctx.values[0] * (1 - t) + ctx.values[ctx.values.length - 1] * t;
 * };
 * ```
 */
class MultiScaleStrategy {
    config;
    constructor(config) {
        this.config = config;
    }
    async apply(input, configOverride) {
        const blend = configOverride?.blend ?? this.config.blend;
        const { width, height } = input;
        // Process each layer using its pre-configured processor
        const layerResults = await Promise.all(this.config.layers
            .map(layer => layer.processor.process(input)));
        // Blend layers using the provided function
        return this.blendLayers(layerResults, this.config.layers, blend, width, height);
    }
    blendLayers(layers, layerConfigs, blend, width, height) {
        const output = (0, index_js_2.createChannelImage)(width, height);
        // Pre-compute normalized weights
        const totalWeight = layerConfigs.reduce((sum, l) => sum + l.weight, 0);
        const normalizedWeights = layerConfigs.map(l => l.weight / totalWeight);
        // Pre-allocate values array for reuse
        const values = new Array(layers.length);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = y * width + x;
                // Gather values from all layers
                for (let j = 0; j < layers.length; j++) {
                    values[j] = layers[j].data[i];
                }
                // Call blend function with full context
                output.data[i] = blend({
                    values,
                    weights: normalizedWeights,
                    x,
                    y,
                    width,
                    height,
                });
            }
        }
        return output;
    }
    /**
     * Create a preset multi-scale configuration
     */
    static withPreset(preset) {
        switch (preset) {
            case 'detailed':
                return new MultiScaleStrategy({
                    layers: [
                        { processor: new index_js_1.XDoG({ sigma: 0.4, p: 25, phi: 50 }), weight: 2 },
                        { processor: new index_js_1.XDoG({ sigma: 1.0, p: 20, phi: 50 }), weight: 1 },
                    ],
                    blend: exports.BlendFunctions.min,
                });
            case 'balanced':
                return new MultiScaleStrategy({
                    layers: [
                        { processor: new index_js_1.XDoG({ sigma: 0.8, p: 20 }), weight: 1 },
                        { processor: new index_js_1.FDoG({ sigma: 1.6, sigmaM: 3.0 }), weight: 2 },
                        { processor: new index_js_1.FDoG({ sigma: 3.2, sigmaM: 5.0 }), weight: 1 },
                    ],
                    blend: exports.BlendFunctions.average,
                });
            case 'abstract':
                return new MultiScaleStrategy({
                    layers: [
                        { processor: new index_js_1.FDoG({ sigma: 2.0, sigmaM: 4.0 }), weight: 1 },
                        { processor: new index_js_1.FDoG({ sigma: 5.0, sigmaM: 6.0 }), weight: 2 },
                        { processor: new index_js_1.FDoG({ sigma: 10.0, sigmaM: 8.0 }), weight: 1 },
                    ],
                    blend: exports.BlendFunctions.max,
                });
        }
    }
    /**
     * Get the configured layers (useful for inspection/debugging)
     */
    getLayers() {
        return this.config.layers;
    }
    /**
     * Get the blend function
     */
    getBlendFunction() {
        return this.config.blend;
    }
}
exports.MultiScaleStrategy = MultiScaleStrategy;
// =============================================================================
// Utility: Create Custom Blend Functions
// =============================================================================
/**
 * Creates a weighted percentile blend function
 *
 * @param percentile - Value from 0 to 1 (0 = min, 0.5 = median, 1 = max)
 * @returns A blend function that selects the given percentile
 *
 * @example
 * ```typescript
 * const medianBlend = createPercentileBlend(0.5);
 * const multiScale = new MultiScaleStrategy({
 *   layers: [...],
 *   blend: medianBlend,
 * });
 * ```
 */
function createPercentileBlend(percentile) {
    return (ctx) => {
        const sorted = [...ctx.values].sort((a, b) => a - b);
        const index = Math.min(Math.floor(percentile * sorted.length), sorted.length - 1);
        return sorted[index];
    };
}
/**
 * Creates a blend function that interpolates between two other blend functions
 * based on a spatial mask or gradient
 *
 * @param blendA - First blend function
 * @param blendB - Second blend function
 * @param mixer - Function that returns interpolation factor (0 = use A, 1 = use B)
 * @returns Combined blend function
 *
 * @example Radial gradient between min and average
 * ```typescript
 * const radialBlend = createMixedBlend(
 *   BlendFunctions.min,
 *   BlendFunctions.average,
 *   (ctx) => {
 *     const cx = ctx.width / 2, cy = ctx.height / 2;
 *     const dist = Math.hypot(ctx.x - cx, ctx.y - cy);
 *     const maxDist = Math.hypot(cx, cy);
 *     return dist / maxDist;
 *   }
 * );
 * ```
 */
function createMixedBlend(blendA, blendB, mixer) {
    return (ctx) => {
        const a = blendA(ctx);
        const b = blendB(ctx);
        const t = Math.max(0, Math.min(1, mixer(ctx)));
        return a * (1 - t) + b * t;
    };
}
/**
 * Creates a blend function that applies gamma correction to another blend
 *
 * @param baseBlend - The base blend function
 * @param gamma - Gamma value (< 1 brightens, > 1 darkens)
 * @returns Gamma-corrected blend function
 */
function createGammaCorrectedBlend(baseBlend, gamma) {
    return (ctx) => Math.pow(baseBlend(ctx), gamma);
}
//# sourceMappingURL=multi-scale.js.map