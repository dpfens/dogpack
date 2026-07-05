/**
 * Multi-Scale Strategy Types and Implementation
 *
 * Refactored to use function-based blending, allowing users to either:
 * 1. Use the provided blend functions (average, min, max, multiply)
 * 2. Supply their own custom blend function
 */
import { ChannelImage, DoGImplementation } from '../types.js';
import { ExtensionStrategy } from './base.js';
/**
 * Context provided to blend functions for each pixel
 */
export interface BlendContext {
    /** Pixel values from each layer at the current position */
    values: number[];
    /** Normalized weights for each layer (sum to 1.0) */
    weights: number[];
    /** Current pixel x coordinate */
    x: number;
    /** Current pixel y coordinate */
    y: number;
    /** Image width */
    width: number;
    /** Image height */
    height: number;
}
/**
 * Function type for blending multiple layer values into a single output value.
 *
 * @param ctx - Context containing pixel values, weights, and position info
 * @returns The blended output value (should be in 0-1 range)
 *
 * @example Custom blend function
 * ```typescript
 * const softMin: BlendFunction = (ctx) => {
 *   // Soft minimum using negative log-sum-exp
 *   const k = 10; // sharpness parameter
 *   const sumExp = ctx.values.reduce((sum, v) => sum + Math.exp(-k * v), 0);
 *   return -Math.log(sumExp / ctx.values.length) / k;
 * };
 * ```
 */
export type BlendFunction = (ctx: BlendContext) => number;
/**
 * Weighted average blend - smoothly combines all layers
 *
 * Best for: Balanced multi-scale results, general purpose
 */
export declare const blendAverage: BlendFunction;
/**
 * Minimum blend - takes the darkest value at each pixel
 *
 * Best for: Preserving fine details, ensuring all edges are captured
 * Since edges are dark (0) on white (1), min keeps all detected edges
 */
export declare const blendMin: BlendFunction;
/**
 * Maximum blend - takes the brightest value at each pixel
 *
 * Best for: Abstract styles where only strong edges should appear
 * Removes edges that don't appear in all scales
 */
export declare const blendMax: BlendFunction;
/**
 * Multiply blend - multiplies all layer values together
 *
 * Best for: Strong edge emphasis, high contrast results
 * Areas that are dark in any layer become very dark
 */
export declare const blendMultiply: BlendFunction;
/**
 * Screen blend - inverse of multiply, brightens the result
 *
 * Best for: Lighter, more ethereal line drawings
 */
export declare const blendScreen: BlendFunction;
/**
 * Soft light blend - subtle contrast enhancement
 *
 * Best for: Natural-looking multi-scale combination
 */
export declare const blendSoftLight: BlendFunction;
/**
 * Overlay blend - combines multiply and screen based on base value
 *
 * Best for: High contrast results that preserve both highlights and shadows
 */
export declare const blendOverlay: BlendFunction;
/**
 * Geometric mean blend - multiplicative average, less extreme than multiply
 *
 * Best for: Balanced darkening that respects layer weights
 */
export declare const blendGeometricMean: BlendFunction;
/**
 * Harmonic mean blend - emphasizes smaller values more than arithmetic mean
 *
 * Best for: Preserving fine details while still allowing averaging
 */
export declare const blendHarmonicMean: BlendFunction;
/**
 * Median blend - selects the middle value, robust to outliers
 *
 * Best for: Noise-resistant combination when layer count is odd
 */
export declare const blendMedian: BlendFunction;
/**
 * Soft min blend - smooth approximation of minimum using log-sum-exp
 *
 * Best for: Capturing all edges with smoother transitions than hard min
 */
export declare const blendSoftMin: BlendFunction;
/**
 * Soft max blend - smooth approximation of maximum using log-sum-exp
 *
 * Best for: Selecting dominant edges with smoother transitions than hard max
 */
export declare const blendSoftMax: BlendFunction;
/**
 * Difference blend - absolute difference between layers (best with 2 layers)
 *
 * Best for: Highlighting scale-dependent features, edge comparison
 */
export declare const blendDifference: BlendFunction;
/**
 * Priority blend - uses fine scale unless coarse scale has strong edges
 *
 * Best for: Detail preservation with fallback to coarse structure
 * Assumes layers ordered fine-to-coarse (first = finest detail)
 */
export declare const blendPriority: BlendFunction;
/**
 * Collection of all built-in blend functions for easy access
 */
export declare const BlendFunctions: {
    readonly average: BlendFunction;
    readonly min: BlendFunction;
    readonly max: BlendFunction;
    readonly multiply: BlendFunction;
    readonly screen: BlendFunction;
    readonly softLight: BlendFunction;
    readonly overlay: BlendFunction;
    readonly geometricMean: BlendFunction;
    readonly harmonicMean: BlendFunction;
    readonly median: BlendFunction;
    readonly softMin: BlendFunction;
    readonly softMax: BlendFunction;
    readonly difference: BlendFunction;
    readonly priority: BlendFunction;
};
/**
 * Type representing the names of built-in blend functions
 */
export type BuiltinBlendMode = keyof typeof BlendFunctions;
/**
 * Configuration for a single scale layer
 */
export interface MultiScaleLayer {
    /** Pre-configured XDoG or FDoG processor instance */
    processor: DoGImplementation;
    /** Weight for blending (will be normalized) */
    weight: number;
}
/**
 * Multi-scale configuration
 */
export interface MultiScaleConfig {
    /** Layer specifications with processor instances */
    layers: MultiScaleLayer[];
    /**
     * Blend function for combining layers.
     *
     * Can be either:
     * - A built-in blend function from BlendFunctions (e.g., BlendFunctions.min)
     * - A custom BlendFunction
     *
     * @example Using built-in
     * ```typescript
     * { layers: [...], blend: BlendFunctions.average }
     * ```
     *
     * @example Using custom function
     * ```typescript
     * {
     *   layers: [...],
     *   blend: (ctx) => {
     *     // Custom logic using ctx.values, ctx.weights, ctx.x, ctx.y
     *     return Math.min(...ctx.values) * 0.8 + ctx.values[0] * 0.2;
     *   }
     * }
     * ```
     */
    blend: BlendFunction;
}
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
export declare class MultiScaleStrategy implements ExtensionStrategy<MultiScaleConfig, ChannelImage, ChannelImage> {
    private config;
    constructor(config: MultiScaleConfig);
    apply(input: ChannelImage, configOverride?: Partial<Pick<MultiScaleConfig, 'blend'>>): Promise<ChannelImage>;
    private blendLayers;
    /**
     * Create a preset multi-scale configuration
     */
    static withPreset(preset: 'detailed' | 'balanced' | 'abstract'): MultiScaleStrategy;
    /**
     * Get the configured layers (useful for inspection/debugging)
     */
    getLayers(): ReadonlyArray<MultiScaleLayer>;
    /**
     * Get the blend function
     */
    getBlendFunction(): BlendFunction;
}
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
export declare function createPercentileBlend(percentile: number): BlendFunction;
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
export declare function createMixedBlend(blendA: BlendFunction, blendB: BlendFunction, mixer: (ctx: BlendContext) => number): BlendFunction;
/**
 * Creates a blend function that applies gamma correction to another blend
 *
 * @param baseBlend - The base blend function
 * @param gamma - Gamma value (< 1 brightens, > 1 darkens)
 * @returns Gamma-corrected blend function
 */
export declare function createGammaCorrectedBlend(baseBlend: BlendFunction, gamma: number): BlendFunction;
//# sourceMappingURL=multi-scale.d.ts.map