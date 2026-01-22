/**
 * XDoG/FDoG Extensions Module
 *
 * Provides composable strategy patterns for extending XDoG/FDoG output:
 * - Hatching: Multiple threshold masks for tonal art maps
 * - Natural Media: Pencil, pastel, charcoal effects via parameter tuning
 * - Anti-aliasing: LIC pass along edge tangent flow
 * - Color Retention: Modulating stylized output with source colors
 * - Multi-scale: Combining results at different σ values
 *
 * Based on Sections 4.3, 5.1, 5.2 of:
 * "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 *
 * Design Philosophy:
 * - Each extension is a standalone strategy that can be composed
 * - Developers control XDoG vs FDoG choice and parameters
 * - Extensions accept pre-processed results or raw images
 * - Chainable pipeline architecture
 */
import { GrayscaleImage, FDoGConfig, FlowField } from './types.js';
import { XDoG, FDoG } from './xdog.js';
import { EdgeTangentFlow } from './etf/index.js';
/**
 * Base interface for all extension strategies
 */
export interface ExtensionStrategy<TConfig, TInput, TOutput> {
    apply(input: TInput, config?: Partial<TConfig>): Promise<TOutput>;
}
/**
 * RGB image representation for color operations
 */
export interface RGBImage {
    r: Float32Array;
    g: Float32Array;
    b: Float32Array;
    width: number;
    height: number;
}
/**
 * Result from a DoG processor (either XDoG or FDoG)
 */
export interface DoGResult {
    /** The final processed image */
    image: GrayscaleImage;
    /** The sharpened image before thresholding (if available) */
    sharpened?: GrayscaleImage;
    /** Edge tangent flow (only from FDoG) */
    etf?: EdgeTangentFlow;
    /** The original grayscale input */
    originalGray?: GrayscaleImage;
    /** The original color input (if provided) */
    originalColor?: RGBImage;
}
/**
 * Anti-aliasing configuration
 *
 * From Section 4.3: "Since many of the examples in this paper use the ETF
 * field to compute coherent edges, we can easily re-use the ETF to apply
 * a very small line integral convolution along the field"
 */
export interface AntiAliasingConfig {
    /**
     * Integration sigma along the flow direction (default: 1.0)
     * - 0.5-2 pixels: Standard anti-aliasing
     * - >2: Stylistic smoothing effect
     */
    sigma: number;
    /**
     * Step size for LIC sampling (default: 0.5)
     */
    stepSize: number;
}
/**
 * Anti-Aliasing Strategy
 *
 * Applies line integral convolution along the edge tangent flow
 * to produce image-coherent and visually pleasing anti-aliasing.
 *
 * @example
 * ```typescript
 * const fdog = new FDoG({ ... });
 * const result = await fdog.processDetailed(input);
 *
 * const aa = new AntiAliasingStrategy();
 * const smoothed = await aa.apply({
 *   image: result.result,
 *   etf: result.etf
 * }, { sigma: 1.5 });
 * ```
 */
export declare class AntiAliasingStrategy implements ExtensionStrategy<AntiAliasingConfig, {
    image: GrayscaleImage;
    etf: FlowField;
}, GrayscaleImage> {
    private config;
    constructor(config?: Partial<AntiAliasingConfig>);
    apply(input: {
        image: GrayscaleImage;
        etf: FlowField;
    }, configOverride?: Partial<AntiAliasingConfig>): Promise<GrayscaleImage>;
    /**
     * Create anti-aliasing with preset intensity
     */
    static withPreset(preset: 'subtle' | 'standard' | 'stylistic'): AntiAliasingStrategy;
}
/**
 * Hatching texture specification
 */
export interface HatchTexture {
    /** Grayscale texture data (tiled as needed) */
    data: GrayscaleImage;
    /** Rotation angle in radians (0 = horizontal) */
    rotation: number;
}
/**
 * Hatching configuration
 *
 * From Section 5.1: "Our hatching approach is based on the concept of
 * tonal art maps, where layers of strokes add up to achieve a desired tone"
 */
export interface HatchingConfig {
    /**
     * Threshold levels for creating masks (ascending order)
     * Each level creates a separate tone band
     * Default: [0.3, 0.5, 0.7] creates 4 bands
     */
    thresholdLevels: number[];
    /**
     * Hatching textures for each band (darkest to lightest)
     * Should have length = thresholdLevels.length + 1
     */
    textures?: HatchTexture[];
    /**
     * Background/paper texture (optional)
     */
    paperTexture?: GrayscaleImage;
    /**
     * Sharpening strength for threshold masks (default: 20)
     */
    p: number;
    /**
     * Threshold sharpness - high values for crisp hatching masks (default: 100)
     */
    phi: number;
}
/**
 * Hatching Strategy
 *
 * Creates tonal art maps by computing multiple threshold levels from a
 * sharpened XDoG/FDoG image and using them as masks for hatching textures.
 *
 * @example
 * ```typescript
 * const xdog = new XDoG({ p: 20 });
 * const sharpened = await xdog.processSharpened(input);
 *
 * const hatching = new HatchingStrategy({
 *   thresholdLevels: [0.25, 0.5, 0.75],
 *   textures: [darkHatch, medHatch, lightHatch, white],
 * });
 * const result = await hatching.apply({ sharpened, original: input });
 * ```
 */
export declare class HatchingStrategy implements ExtensionStrategy<HatchingConfig, {
    sharpened: GrayscaleImage;
    original?: GrayscaleImage;
}, GrayscaleImage> {
    private config;
    constructor(config?: Partial<HatchingConfig>);
    /**
     * Generate threshold masks for each tone band
     */
    generateMasks(sharpened: GrayscaleImage, configOverride?: Partial<HatchingConfig>): GrayscaleImage[];
    apply(input: {
        sharpened: GrayscaleImage;
        original?: GrayscaleImage;
    }, configOverride?: Partial<HatchingConfig>): Promise<GrayscaleImage>;
    /**
     * Sample a texture with tiling and rotation
     */
    private sampleTexture;
    /**
     * Generate a simple procedural hatching texture
     */
    static generateHatchTexture(width: number, height: number, spacing: number, thickness: number, rotation?: number): HatchTexture;
}
/**
 * Natural media style presets
 */
export type NaturalMediaStyle = 'pencilShading' | 'pastel' | 'charcoal' | 'dryBrush';
/**
 * Natural media configuration
 *
 * From Section 5.2: Parameters for various natural media looks
 */
export interface NaturalMediaConfig {
    /** Base style preset */
    style: NaturalMediaStyle;
    /** Override sigma for edge detection */
    sigma?: number;
    /** Override p for edge emphasis */
    p?: number;
    /** Override phi for threshold sharpness */
    phi?: number;
    /** Override epsilon for threshold level */
    epsilon?: number;
    /** For FDoG: structure tensor smoothing */
    sigmaC?: number;
    /** For FDoG: flow-aligned smoothing */
    sigmaM?: number;
    /** For FDoG: anti-aliasing */
    sigmaA?: number;
    /** Use flow-based processing (FDoG) */
    useFlow?: boolean;
}
/**
 * Natural Media Strategy
 *
 * Provides preset parameter configurations for pencil, pastel, charcoal,
 * and other natural media styles as described in Section 5.2.
 *
 * @example
 * ```typescript
 * const naturalMedia = new NaturalMediaStrategy({ style: 'pastel' });
 * const result = await naturalMedia.apply(input);
 * ```
 */
export declare class NaturalMediaStrategy implements ExtensionStrategy<NaturalMediaConfig, GrayscaleImage, GrayscaleImage> {
    private config;
    /**
     * Style presets from Section 5.2 and Table A.1
     */
    static readonly PRESETS: Record<NaturalMediaStyle, Partial<FDoGConfig> & {
        useFlow: boolean;
    }>;
    constructor(config?: Partial<NaturalMediaConfig>);
    /**
     * Get the resolved configuration for the current style
     */
    getResolvedConfig(): Partial<FDoGConfig> & {
        useFlow: boolean;
    };
    apply(input: GrayscaleImage, configOverride?: Partial<NaturalMediaConfig>): Promise<GrayscaleImage>;
    /**
     * Create strategy for a specific style
     */
    static forStyle(style: NaturalMediaStyle): NaturalMediaStrategy;
}
/**
 * Color retention configuration
 */
export interface ColorRetentionConfig {
    /**
     * Blend mode for combining stylized and color
     * - 'multiply': Multiply color by inverted stylized
     * - 'overlay': Overlay blend mode
     * - 'softLight': Soft light blend
     * - 'luminosity': Replace luminosity only
     */
    blendMode: 'multiply' | 'overlay' | 'softLight' | 'luminosity';
    /**
     * Strength of color retention (0 = no color, 1 = full color)
     * Default: 1.0
     */
    strength: number;
    /**
     * Invert the stylized image before blending
     * Useful for line art where black should preserve color
     */
    invertStylized: boolean;
}
/**
 * Color Retention Strategy
 *
 * Modulates stylized output with source image colors.
 * From Section 5.2: "We achieve the colored pastel look by modulating
 * the natural media appearance with source image colors, which are
 * weighted by inverting the stylized result."
 *
 * @example
 * ```typescript
 * const stylized = await fdog.process(grayInput);
 * const colorRetain = new ColorRetentionStrategy({ blendMode: 'multiply' });
 * const colorResult = await colorRetain.apply({
 *   stylized,
 *   originalColor: rgbInput
 * });
 * ```
 */
export declare class ColorRetentionStrategy implements ExtensionStrategy<ColorRetentionConfig, {
    stylized: GrayscaleImage;
    originalColor: RGBImage;
}, RGBImage> {
    private config;
    constructor(config?: Partial<ColorRetentionConfig>);
    apply(input: {
        stylized: GrayscaleImage;
        originalColor: RGBImage;
    }, configOverride?: Partial<ColorRetentionConfig>): Promise<RGBImage>;
    private blend;
    private overlayChannel;
    private softLightChannel;
}
/**
 * Processor type that can be used in multi-scale layers
 */
export type DoGProcessor = XDoG | FDoG;
/**
 * Multi-scale layer configuration
 */
export interface MultiScaleLayer {
    /** Pre-configured XDoG or FDoG processor instance */
    processor: DoGProcessor;
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
     * Blend mode for combining layers
     * - 'average': Weighted average
     * - 'min': Take minimum (darkest)
     * - 'max': Take maximum (brightest)
     * - 'multiply': Multiply all layers
     */
    blendMode: 'average' | 'min' | 'max' | 'multiply';
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
 * @example
 * ```typescript
 * const multiScale = new MultiScaleStrategy({
 *   layers: [
 *     { processor: new XDoG({ sigma: 0.5, p: 30 }), weight: 1 },
 *     { processor: new FDoG({ sigma: 2.0, sigmaM: 4.0 }), weight: 2 },
 *     { processor: XDoG.withPreset('pencilShading'), weight: 0.5 },
 *   ],
 *   blendMode: 'min',
 * });
 * const result = await multiScale.apply(input);
 * ```
 *
 * @example Using with custom blur strategies
 * ```typescript
 * // Each processor can be configured independently
 * const multiScale = new MultiScaleStrategy({
 *   layers: [
 *     { processor: new XDoG({ sigma: 0.4, p: 20, phi: 100 }), weight: 2 },
 *     { processor: new FDoG({ sigma: 1.6, sigmaC: 2.5, sigmaM: 4.0 }), weight: 1 },
 *   ],
 *   blendMode: 'average',
 * });
 * ```
 */
export declare class MultiScaleStrategy implements ExtensionStrategy<MultiScaleConfig, GrayscaleImage, GrayscaleImage> {
    private config;
    constructor(config: MultiScaleConfig);
    apply(input: GrayscaleImage, configOverride?: Partial<Pick<MultiScaleConfig, 'blendMode'>>): Promise<GrayscaleImage>;
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
     * Get the blend mode
     */
    getBlendMode(): MultiScaleConfig['blendMode'];
}
/**
 * Pipeline step specification
 */
export type PipelineStep<TIn, TOut> = {
    name: string;
    apply: (input: TIn) => Promise<TOut>;
};
/**
 * Extension Pipeline
 *
 * Composes multiple extension strategies into a single processing pipeline.
 * Provides type-safe chaining of operations.
 *
 * @example
 * ```typescript
 * const pipeline = new ExtensionPipeline()
 *   .addStep('naturalMedia', async (input: GrayscaleImage) => {
 *     const nm = new NaturalMediaStrategy({ style: 'pastel' });
 *     return nm.apply(input);
 *   })
 *   .addStep('antiAlias', async (image: GrayscaleImage) => {
 *     const etf = EdgeTangentFlow.compute(originalInput);
 *     const aa = new AntiAliasingStrategy({ sigma: 1.5 });
 *     return aa.apply({ image, etf });
 *   });
 *
 * const result = await pipeline.run(input);
 * ```
 */
export declare class ExtensionPipeline<TInput, TCurrent = TInput> {
    private steps;
    /**
     * Add a processing step to the pipeline
     */
    addStep<TNext>(name: string, fn: (input: TCurrent) => Promise<TNext>): ExtensionPipeline<TInput, TNext>;
    /**
     * Run the pipeline
     */
    run(input: TInput): Promise<TCurrent>;
    /**
     * Get step names for debugging
     */
    getStepNames(): string[];
}
/**
 * Convert ImageData to RGBImage
 */
export declare function imageDataToRGB(imageData: ImageData): RGBImage;
/**
 * Convert RGBImage to ImageData
 */
export declare function rgbToImageData(rgb: RGBImage): ImageData;
/**
 * Convert grayscale to RGB (same value in all channels)
 */
export declare function grayscaleToRGB(gray: GrayscaleImage): RGBImage;
/**
 * Convert RGB to grayscale using luminance formula
 */
export declare function rgbToGrayscale(rgb: RGBImage): GrayscaleImage;
//# sourceMappingURL=extensions.d.ts.map