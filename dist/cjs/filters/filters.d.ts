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
import type { ChannelImage, BilateralFilterConfig, MedianFilterConfig, KuwaharaFilterConfig, ContrastEnhancementConfig, GaussianConfig, QuantizerConfig, IsotropicBlurConfig } from '../interfaces/base.js';
import { ResilientEdgeAwareFilter } from './resilient-filter.js';
import { isWebGLAvailable, disposeWebGL } from './webgl.js';
import { disposeWebGPU } from './webgpu.js';
export interface BackendOptions {
    /** Force CPU even if WebGL/WebGPU are available. Default: false. */
    forceCPU?: boolean;
}
/**
 * Edge-preserving smoothing filter. Resolves the best supported backend
 * at creation time; falls back once if that backend fails later.
 */
export declare class BilateralFilter extends ResilientEdgeAwareFilter<Partial<BilateralFilterConfig>> {
    private static readonly candidates;
    private constructor();
    static create(config?: Partial<BilateralFilterConfig>, options?: BackendOptions): Promise<BilateralFilter>;
}
/**
 * Median filter for salt-and-pepper noise removal.
 */
export declare class MedianFilter extends ResilientEdgeAwareFilter<Partial<MedianFilterConfig>> {
    private static readonly candidates;
    private constructor();
    static create(config?: Partial<MedianFilterConfig>, options?: BackendOptions): Promise<MedianFilter>;
}
/**
 * Kuwahara filter for a painterly, stylized effect.
 */
export declare class KuwaharaFilter extends ResilientEdgeAwareFilter<Partial<KuwaharaFilterConfig>> {
    private static readonly candidates;
    private constructor();
    static create(config?: Partial<KuwaharaFilterConfig>, options?: BackendOptions): Promise<KuwaharaFilter>;
}
/**
 * Separable Isotropic blur.
 */
export declare class IsotropicBlurFilter extends ResilientEdgeAwareFilter<IsotropicBlurConfig> {
    private static readonly candidates;
    private constructor();
    static create(config: IsotropicBlurConfig, options?: BackendOptions): Promise<IsotropicBlurFilter>;
}
/**
 * Separable Gaussian blur.
 */
export declare class GaussianBlur extends ResilientEdgeAwareFilter<GaussianConfig> {
    private static readonly candidates;
    private constructor();
    static create(config: GaussianConfig, options?: BackendOptions): Promise<GaussianBlur>;
}
export declare class ContrastEnhancer extends ResilientEdgeAwareFilter<ContrastEnhancementConfig> {
    private static readonly candidates;
    private constructor();
    static create(blackPoint?: number, whitePoint?: number, options?: BackendOptions): Promise<ContrastEnhancer>;
}
/**
 * Posterize/quantize intensity levels.
 */
export declare class Quantizer extends ResilientEdgeAwareFilter<QuantizerConfig> {
    private static readonly candidates;
    private constructor();
    static create(config: QuantizerConfig, options?: BackendOptions): Promise<Quantizer>;
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
export { isWebGLAvailable, disposeWebGL, disposeWebGPU };
//# sourceMappingURL=filters.d.ts.map