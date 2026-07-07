/**
 * Color Retention Extension - Extensible Architecture
 *
 * Provides a composable, hook-based system for combining stylized XDoG/FDoG
 * output with original colors. Developers can inject custom logic at every
 * stage of the pipeline.
 *
 * Pipeline stages:
 * 1. Mask Transform: Modify the stylized mask before blending
 * 2. Color Transform: Pre-process the original color
 * 3. Blend Function: Combine mask and color (the core operation)
 * 4. Post-Process: Final adjustments to the output
 *
 * Based on Section 5.2 of the XDoG paper.
 */
import type { ChannelImage } from '../types';
import type { RGBImage } from './base';
/**
 * RGBA color tuple (values in 0-1 range)
 */
export type Color = [r: number, g: number, b: number];
/**
 * Pixel context provided to all hook functions
 * Contains spatial and neighborhood information for advanced effects
 */
export interface PixelContext {
    /** Current pixel x coordinate */
    x: number;
    /** Current pixel y coordinate */
    y: number;
    /** Linear index into the image array */
    index: number;
    /** Image width */
    width: number;
    /** Image height */
    height: number;
    /** Normalized x coordinate (0-1) */
    u: number;
    /** Normalized v coordinate (0-1) */
    v: number;
    /**
     * Sample the original color at an offset from current pixel
     * Useful for blur, sharpen, or texture effects
     */
    sampleColor: (dx: number, dy: number) => Color;
    /**
     * Sample the mask at an offset from current pixel
     */
    sampleMask: (dx: number, dy: number) => number;
    /**
     * Get a value from the shared state (for multi-pass effects)
     */
    getState: <T>(key: string) => T | undefined;
    /**
     * Set a value in the shared state
     */
    setState: <T>(key: string, value: T) => void;
}
/**
 * Transform the stylized mask value before blending
 *
 * @param mask - Original mask value (0 = edge, 1 = background)
 * @param ctx - Pixel context with spatial info and sampling functions
 * @returns Transformed mask value
 *
 * @example
 * ```typescript
 * // Increase edge thickness by expanding dark regions
 * const thickenEdges: MaskTransformFn = (mask, ctx) => {
 *   // Sample neighbors and take minimum (expand dark)
 *   let min = mask;
 *   for (let dy = -1; dy <= 1; dy++) {
 *     for (let dx = -1; dx <= 1; dx++) {
 *       min = Math.min(min, ctx.sampleMask(dx, dy));
 *     }
 *   }
 *   return min;
 * };
 * ```
 */
export type MaskTransformFn = (mask: number, ctx: PixelContext) => number;
/**
 * Transform the original color before blending
 *
 * @param color - Original RGB color
 * @param mask - Current mask value (after mask transform)
 * @param ctx - Pixel context
 * @returns Transformed color
 *
 * @example
 * ```typescript
 * // Boost saturation in non-edge areas
 * const boostSaturation: ColorTransformFn = (color, mask, ctx) => {
 *   const [h, s, l] = rgbToHsl(...color);
 *   const boostedS = s * (1 + 0.3 * mask); // More saturation where mask is light
 *   return hslToRgb(h, Math.min(1, boostedS), l);
 * };
 * ```
 */
export type ColorTransformFn = (color: Color, mask: number, ctx: PixelContext) => Color;
/**
 * Core blend function that combines mask and color
 *
 * @param color - Transformed color
 * @param mask - Transformed mask value
 * @param ctx - Pixel context
 * @returns Blended output color
 *
 * @example
 * ```typescript
 * // Simple multiply blend
 * const multiply: BlendFn = (color, mask) => {
 *   return [color[0] * mask, color[1] * mask, color[2] * mask];
 * };
 *
 * // Screen blend for lighter result
 * const screen: BlendFn = (color, mask) => {
 *   return [
 *     1 - (1 - color[0]) * (1 - mask),
 *     1 - (1 - color[1]) * (1 - mask),
 *     1 - (1 - color[2]) * (1 - mask),
 *   ];
 * };
 * ```
 */
export type BlendFn = (color: Color, mask: number, ctx: PixelContext) => Color;
/**
 * Post-process the blended result
 *
 * @param color - Blended color
 * @param originalColor - Original input color (for reference)
 * @param mask - Final mask value
 * @param ctx - Pixel context
 * @returns Final output color
 *
 * @example
 * ```typescript
 * // Add vignette effect
 * const vignette: PostProcessFn = (color, original, mask, ctx) => {
 *   const dist = Math.sqrt((ctx.u - 0.5) ** 2 + (ctx.v - 0.5) ** 2);
 *   const vignette = 1 - Math.min(1, dist * 1.2);
 *   return [color[0] * vignette, color[1] * vignette, color[2] * vignette];
 * };
 * ```
 */
export type PostProcessFn = (color: Color, originalColor: Color, mask: number, ctx: PixelContext) => Color;
/**
 * Global pre-processing hook (runs once before pixel iteration)
 * Useful for computing histograms, statistics, or initializing state
 */
export type PreProcessHook = (stylized: ChannelImage, originalColor: RGBImage, state: Map<string, unknown>) => void;
/**
 * Global post-processing hook (runs once after pixel iteration)
 * Useful for normalization, filtering, or multi-pass effects
 */
export type GlobalPostProcessHook = (output: RGBImage, state: Map<string, unknown>) => RGBImage;
/**
 * Full configuration for the color retention pipeline
 */
export interface ColorRetentionConfig {
    /**
     * Mask transformation function
     * Default: identity (no change)
     */
    maskTransform?: MaskTransformFn;
    /**
     * Color transformation function
     * Default: identity (no change)
     */
    colorTransform?: ColorTransformFn;
    /**
     * Core blend function (required or use preset)
     */
    blend: BlendFn;
    /**
     * Post-processing function
     * Default: identity (no change)
     */
    postProcess?: PostProcessFn;
    /**
     * Global pre-processing hook
     */
    preProcess?: PreProcessHook;
    /**
     * Global post-processing hook
     */
    globalPostProcess?: GlobalPostProcessHook;
    /**
     * Chain multiple mask transforms (applied in order)
     */
    maskTransformChain?: MaskTransformFn[];
    /**
     * Chain multiple color transforms (applied in order)
     */
    colorTransformChain?: ColorTransformFn[];
    /**
     * Chain multiple post-process functions (applied in order)
     */
    postProcessChain?: PostProcessFn[];
}
/**
 * Extensible Color Retention Strategy
 *
 * A fully customizable pipeline for combining stylized edges with colors.
 * Every stage can be overridden with custom functions.
 *
 * @example Basic usage with preset
 * ```typescript
 * const strategy = ColorRetentionStrategy.preset('coloredEdges');
 * const result = await strategy.apply({ stylized, originalColor });
 * ```
 *
 * @example Custom blend function
 * ```typescript
 * const strategy = new ColorRetentionStrategy({
 *   blend: (color, mask) => {
 *     // Custom logic here
 *     return [color[0] * mask, color[1] * mask, color[2] * mask];
 *   }
 * });
 * ```
 *
 * @example Full pipeline customization
 * ```typescript
 * const strategy = new ColorRetentionStrategy({
 *   maskTransform: (mask) => Math.pow(mask, 0.8), // Gamma adjust
 *   colorTransform: (color, mask) => boostSaturation(color, 1.2),
 *   blend: BlendFunctions.multiply,
 *   postProcess: (color, orig, mask, ctx) => addVignette(color, ctx),
 * });
 * ```
 *
 * @example Chaining multiple transforms
 * ```typescript
 * const strategy = new ColorRetentionStrategy({
 *   maskTransformChain: [
 *     MaskTransforms.gamma(0.8),
 *     MaskTransforms.threshold(0.1, 0.9),
 *   ],
 *   colorTransformChain: [
 *     ColorTransforms.saturation(1.2),
 *     ColorTransforms.brightness(0.1),
 *   ],
 *   blend: BlendFunctions.coloredEdges(),
 * });
 * ```
 */
export declare class ColorRetentionStrategy {
    private config;
    constructor(config: ColorRetentionConfig);
    apply(input: {
        stylized: ChannelImage;
        originalColor: RGBImage;
    }, configOverride?: Partial<ColorRetentionConfig>): Promise<RGBImage>;
    private buildMaskTransformChain;
    private buildColorTransformChain;
    private buildPostProcessChain;
    private createPixelContext;
    /**
     * Create a strategy from a preset
     */
    static preset(name: keyof typeof Presets): ColorRetentionStrategy;
    /**
     * Create a strategy with just a blend function
     */
    static withBlend(blend: BlendFn): ColorRetentionStrategy;
    /**
     * Builder pattern for constructing complex pipelines
     */
    static builder(): ColorRetentionBuilder;
}
/**
 * Fluent builder for constructing color retention pipelines
 *
 * @example
 * ```typescript
 * const strategy = ColorRetentionStrategy.builder()
 *   .maskTransform(MaskTransforms.gamma(0.8))
 *   .maskTransform(MaskTransforms.clamp(0.05, 0.95))
 *   .colorTransform(ColorTransforms.saturation(1.2))
 *   .blend(BlendFunctions.multiply)
 *   .postProcess(PostProcessors.vignette(0.3))
 *   .build();
 * ```
 */
export declare class ColorRetentionBuilder {
    private maskTransforms;
    private colorTransforms;
    private postProcesses;
    private blendFn?;
    private preProcessHook?;
    private globalPostProcessHook?;
    maskTransform(fn: MaskTransformFn): this;
    colorTransform(fn: ColorTransformFn): this;
    blend(fn: BlendFn): this;
    postProcess(fn: PostProcessFn): this;
    preProcess(fn: PreProcessHook): this;
    globalPostProcess(fn: GlobalPostProcessHook): this;
    build(): ColorRetentionStrategy;
}
/**
 * Collection of common blend functions
 */
export declare const BlendFunctions: {
    /**
     * Simple multiply: color * mask
     * White mask = full color, black mask = black
     */
    multiply: BlendFn;
    /**
     * Screen blend: 1 - (1-color) * (1-mask)
     * Creates lighter results
     */
    screen: BlendFn;
    /**
     * Overlay blend: combines multiply and screen
     */
    overlay: BlendFn;
    /**
     * Soft light blend: gentler than overlay
     */
    softLight: BlendFn;
    /**
     * Colored edges: black lines on colored background
     * Most common use case for line art + color
     */
    coloredEdges: (edgeStrength?: number) => BlendFn;
    /**
     * Tinted lines: edges take on underlying color
     */
    tintedLines: (darkness?: number) => BlendFn;
    /**
     * Luminosity replacement in HSL space
     */
    luminosity: BlendFn;
    /**
     * Linear interpolation between color and grayscale edge
     */
    lerp: (edgeColor?: Color) => BlendFn;
    /**
     * Preserve hue and saturation, replace value (HSV)
     */
    valueReplace: BlendFn;
};
/**
 * Collection of mask transformation functions
 */
export declare const MaskTransforms: {
    /**
     * Gamma correction for mask
     */
    gamma: (gamma: number) => MaskTransformFn;
    /**
     * Clamp mask to range
     */
    clamp: (min: number, max: number) => MaskTransformFn;
    /**
     * Remap mask from [inMin, inMax] to [outMin, outMax]
     */
    remap: (inMin: number, inMax: number, outMin?: number, outMax?: number) => MaskTransformFn;
    /**
     * Invert the mask
     */
    invert: () => MaskTransformFn;
    /**
     * Apply contrast adjustment
     */
    contrast: (amount: number) => MaskTransformFn;
    /**
     * Threshold with soft edges
     */
    softThreshold: (threshold: number, softness?: number) => MaskTransformFn;
    /**
     * Hard threshold (binary)
     */
    threshold: (threshold: number) => MaskTransformFn;
    /**
     * Quantize to N levels
     */
    quantize: (levels: number) => MaskTransformFn;
    /**
     * Morphological dilation (expand dark/edge regions)
     */
    dilate: (radius?: number) => MaskTransformFn;
    /**
     * Morphological erosion (shrink dark/edge regions)
     */
    erode: (radius?: number) => MaskTransformFn;
    /**
     * Gaussian blur approximation
     */
    blur: (radius?: number) => MaskTransformFn;
    /**
     * Add noise to mask
     */
    noise: (amount: number, seed?: number) => MaskTransformFn;
};
/**
 * Collection of color transformation functions
 */
export declare const ColorTransforms: {
    /**
     * Adjust saturation
     */
    saturation: (factor: number) => ColorTransformFn;
    /**
     * Adjust brightness
     */
    brightness: (amount: number) => ColorTransformFn;
    /**
     * Adjust contrast
     */
    contrast: (amount: number) => ColorTransformFn;
    /**
     * Shift hue
     */
    hueShift: (degrees: number) => ColorTransformFn;
    /**
     * Desaturate based on mask (less saturation in edge areas)
     */
    maskBasedDesaturate: (factor?: number) => ColorTransformFn;
    /**
     * Apply a color matrix transformation
     */
    colorMatrix: (matrix: number[][]) => ColorTransformFn;
    /**
     * Sepia tone
     */
    sepia: (intensity?: number) => ColorTransformFn;
    /**
     * Warm/cool temperature adjustment
     */
    temperature: (warmth: number) => ColorTransformFn;
};
/**
 * Collection of post-processing functions
 */
export declare const PostProcessors: {
    /**
     * Add vignette effect
     */
    vignette: (strength?: number, radius?: number) => PostProcessFn;
    /**
     * Add film grain
     */
    grain: (amount?: number, seed?: number) => PostProcessFn;
    /**
     * Blend with original color
     */
    blendOriginal: (amount: number) => PostProcessFn;
    /**
     * Clamp output to valid range
     */
    clampOutput: () => PostProcessFn;
    /**
     * Posterize (reduce color levels)
     */
    posterize: (levels: number) => PostProcessFn;
    /**
     * Edge-aware sharpening
     */
    sharpenEdges: (amount?: number) => PostProcessFn;
};
/**
 * Pre-built configurations for common use cases
 */
export declare const Presets: Record<string, ColorRetentionConfig>;
export declare function imageDataToRGB(imageData: ImageData): RGBImage;
export declare function rgbToImageData(rgb: RGBImage): ImageData;
//# sourceMappingURL=color-retention.d.ts.map