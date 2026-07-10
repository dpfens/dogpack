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
import type { ChannelImage, BilateralFilterConfig, MedianFilterConfig, KuwaharaFilterConfig, Preprocessor } from '../types.js';
import { isWebGLAvailable, disposeWebGL } from './webgl.js';
/**
 * Optional override for backend selection. Useful for tests (deterministic
 * CPU output, or running in a Node environment with no WebGL at all) or for
 * explicitly forcing a backend regardless of what the environment supports.
 */
export interface BackendOptions {
    /** Force CPU even if WebGL is available. Default: false. */
    forceCPU?: boolean;
}
/**
 * Edge-preserving smoothing filter. Uses the GPU implementation when
 * available, otherwise falls back to the CPU implementation.
 */
export declare class BilateralFilter implements Preprocessor {
    private readonly instance;
    constructor(config?: Partial<BilateralFilterConfig>, options?: BackendOptions);
    process(input: ChannelImage): ChannelImage;
}
/**
 * Median filter for salt-and-pepper noise removal.
 */
export declare class MedianFilter implements Preprocessor {
    private readonly instance;
    constructor(config?: Partial<MedianFilterConfig>, options?: BackendOptions);
    process(input: ChannelImage): ChannelImage;
}
/**
 * Kuwahara filter for a painterly, stylized effect.
 */
export declare class KuwaharaFilter implements Preprocessor {
    private readonly instance;
    constructor(config?: Partial<KuwaharaFilterConfig>, options?: BackendOptions);
    process(input: ChannelImage): ChannelImage;
}
/**
 * Separable Gaussian blur.
 */
export declare class GaussianBlur implements Preprocessor {
    private readonly instance;
    constructor(sigma?: number, options?: BackendOptions);
    process(input: ChannelImage): ChannelImage;
}
/**
 * Histogram-percentile contrast stretch.
 */
export declare class ContrastEnhancer implements Preprocessor {
    private readonly instance;
    constructor(blackPoint?: number, whitePoint?: number, options?: BackendOptions);
    process(input: ChannelImage): ChannelImage;
}
/**
 * Posterize/quantize intensity levels.
 */
export declare class Quantizer implements Preprocessor {
    private readonly instance;
    constructor(levels?: number, options?: BackendOptions);
    process(input: ChannelImage): ChannelImage;
}
export declare const PreprocessingPresets: {
    /**
     * Light preprocessing - minimal smoothing
     * Good for: Clean studio photos, illustrations
     */
    light: (input: ChannelImage) => ChannelImage;
    /**
     * Standard preprocessing - balanced smoothing
     * Good for: Most outdoor photos, portraits
     */
    standard: (input: ChannelImage) => ChannelImage;
    /**
     * Heavy preprocessing - aggressive noise removal
     * Good for: Very textured images (grass, foliage, fabric)
     */
    heavy: (input: ChannelImage) => ChannelImage;
    /**
     * Artistic preprocessing - painterly smoothing
     * Good for: Stylized/artistic output
     */
    artistic: (input: ChannelImage) => ChannelImage;
    /**
     * Photo preprocessing - for photos with grass/nature
     * Good for: Landscape, outdoor scenes
     */
    nature: (input: ChannelImage) => ChannelImage;
};
/**
 * Convenience class for chaining preprocessing operations. Each stage picks
 * its backend (GPU vs CPU) independently at the time it's added, using
 * whatever `isWebGLAvailable()` reports at that moment.
 */
export declare class PreprocessingPipeline {
    private readonly options?;
    private operations;
    constructor(options?: BackendOptions | undefined);
    bilateral(config?: Partial<BilateralFilterConfig>): this;
    median(config?: Partial<MedianFilterConfig>): this;
    kuwahara(config?: Partial<KuwaharaFilterConfig>): this;
    gaussian(sigma?: number): this;
    contrast(blackPoint?: number, whitePoint?: number): this;
    quantize(levels?: number): this;
    /**
     * Add an arbitrary custom preprocessing strategy to the pipeline.
     * Bring your own backend selection if needed.
     */
    use(preprocessor: Preprocessor): this;
    apply(input: ChannelImage): ChannelImage;
    clear(): this;
}
export { isWebGLAvailable, disposeWebGL };
//# sourceMappingURL=preprocess.d.ts.map