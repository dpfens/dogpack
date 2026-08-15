/**
 * Composed Preprocessing Module for XDoG/FDoG
 *
 * This module is the single entry point the rest of the codebase should
 * import from. It no longer does its own backend resolution (WebGPU >
 * WebGL > CPU, demote-on-failure, etc.) — that machinery lives once in
 * `ResilientEdgeAwareFilter` and is exercised through the
 * `EdgeAwareFilterCore`-shaped classes exported from `filters/filters.js`
 * (`BilateralFilter`, `MedianFilter`, `KuwaharaFilter`, `GaussianBlur`,
 * `ContrastEnhancer`, `Quantizer`).
 *
 * Every class here is a thin adapter from that `apply(input, params)`
 * shape to the simpler `Preprocessor` shape (`process(input)`, no
 * per-call params) that the rest of this pipeline expects: it remembers
 * the config passed to `create()` and forwards it into `apply()` on
 * every `process()` call. This is exactly the pattern `IsotropicBlur`
 * (blur/isotropic.ts) already uses to wrap `IsotropicBlurFilter`.
 */
import type { ChannelImage, BilateralFilterConfig, MedianFilterConfig, KuwaharaFilterConfig, Preprocessor, LocalVarianceConfig } from '../../interfaces/base.js';
import { isWebGLAvailable, disposeWebGL, disposeWebGPU } from '../../filters/filters.js';
import type { BackendOptions } from '../../filters/filters.js';
export type { BackendOptions };
/**
 * Edge-preserving smoothing filter. Backend resolution and mid-session
 * fallback are handled entirely by the underlying
 * `BilateralEdgeAwareFilter`; this class just remembers the config.
 */
export declare class BilateralFilter implements Preprocessor {
    private readonly filter;
    private readonly config;
    private constructor();
    static create(config?: Partial<BilateralFilterConfig>, options?: BackendOptions): Promise<BilateralFilter>;
    get backend(): "cpu" | "webgl" | "webgpu";
    dispose(): void;
    process(input: ChannelImage): Promise<ChannelImage>;
}
/**
 * Median filter for salt-and-pepper noise removal.
 */
export declare class MedianFilter implements Preprocessor {
    private readonly filter;
    private readonly config;
    private constructor();
    static create(config?: Partial<MedianFilterConfig>, options?: BackendOptions): Promise<MedianFilter>;
    get backend(): "cpu" | "webgl" | "webgpu";
    dispose(): void;
    process(input: ChannelImage): Promise<ChannelImage>;
}
/**
 * Kuwahara filter for a painterly, stylized effect.
 */
export declare class KuwaharaFilter implements Preprocessor {
    private readonly filter;
    private readonly config;
    private constructor();
    static create(config?: Partial<KuwaharaFilterConfig>, options?: BackendOptions): Promise<KuwaharaFilter>;
    get backend(): "cpu" | "webgl" | "webgpu";
    dispose(): void;
    process(input: ChannelImage): Promise<ChannelImage>;
}
/**
 * Separable Gaussian blur.
 */
export declare class GaussianBlur implements Preprocessor {
    private readonly filter;
    private readonly config;
    private constructor();
    static create(sigma?: number, options?: BackendOptions): Promise<GaussianBlur>;
    get backend(): "cpu" | "webgl" | "webgpu";
    dispose(): void;
    process(input: ChannelImage): Promise<ChannelImage>;
}
/**
 * Black/white point contrast stretch.
 */
export declare class ContrastEnhancer implements Preprocessor {
    private readonly filter;
    private readonly config;
    private constructor();
    static create(blackPoint?: number, whitePoint?: number, options?: BackendOptions): Promise<ContrastEnhancer>;
    get backend(): "cpu" | "webgl" | "webgpu";
    dispose(): void;
    process(input: ChannelImage): Promise<ChannelImage>;
}
/**
 * Posterize/quantize intensity levels.
 */
export declare class Quantizer implements Preprocessor {
    private readonly filter;
    private readonly config;
    private constructor();
    static create(levels?: number, options?: BackendOptions): Promise<Quantizer>;
    get backend(): "cpu" | "webgl" | "webgpu";
    dispose(): void;
    process(input: ChannelImage): Promise<ChannelImage>;
}
export declare class LocalVariance implements Preprocessor {
    private readonly filter;
    private readonly config;
    private constructor();
    static create(config: Partial<LocalVarianceConfig>): Promise<LocalVariance>;
    get backend(): "cpu";
    dispose(): void;
    process(input: ChannelImage): Promise<ChannelImage>;
}
export declare const PreprocessingPresets: {
    /**
     * Light preprocessing - minimal smoothing
     * Good for: Clean studio photos, illustrations
     */
    light: (input: ChannelImage) => Promise<ChannelImage>;
    /**
     * Standard preprocessing - balanced smoothing
     * Good for: Most outdoor photos, portraits
     */
    standard: (input: ChannelImage) => Promise<ChannelImage>;
    /**
     * Heavy preprocessing - aggressive noise removal
     * Good for: Very textured images (grass, foliage, fabric)
     */
    heavy: (input: ChannelImage) => Promise<ChannelImage>;
    /**
     * Artistic preprocessing - painterly smoothing
     * Good for: Stylized/artistic output
     */
    artistic: (input: ChannelImage) => Promise<ChannelImage>;
    /**
     * Photo preprocessing - for photos with grass/nature
     * Good for: Landscape, outdoor scenes
     */
    nature: (input: ChannelImage) => Promise<ChannelImage>;
};
export declare class PreprocessingPipeline {
    private readonly options?;
    private operations;
    constructor(options?: BackendOptions | undefined);
    bilateral(config?: Partial<BilateralFilterConfig>): Promise<this>;
    median(config?: Partial<MedianFilterConfig>): Promise<this>;
    kuwahara(config?: Partial<KuwaharaFilterConfig>): Promise<this>;
    gaussian(sigma?: number): Promise<this>;
    contrast(blackPoint?: number, whitePoint?: number): Promise<this>;
    quantize(levels?: number): Promise<this>;
    /**
     * Add an arbitrary custom preprocessing strategy to the pipeline.
     * Bring your own backend selection if needed.
     */
    use(preprocessor: Preprocessor): this;
    apply(input: ChannelImage): Promise<ChannelImage>;
    /** Disposes every staged operation's resources and clears the pipeline. */
    clear(): this;
}
export { isWebGLAvailable, disposeWebGL, disposeWebGPU };
//# sourceMappingURL=index.d.ts.map