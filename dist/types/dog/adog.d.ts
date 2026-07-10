/**
 * High-level ADog implementations
 *
 * These classes provide convenient wrappers that compose the blur strategies
 * and DoG processor together.
 */
import { type ChannelImage } from '../types.js';
import { type ADoGConfig, type ADoGProcessingResult, type DoGImplementation } from './types.js';
export declare class ADoG implements DoGImplementation {
    private config;
    private blurStrategy;
    constructor(config?: Partial<ADoGConfig>);
    dispose(): void;
    /**
     * Process a grayscale image through the ADoG pipeline.
     *
     * Note on the DoGImplementation interface: this method's `overrides` is
     * typed against Partial<ADoGConfig> (a superset of DoGConfig), which
     * satisfies DoGImplementation's Partial<DoGConfig> parameter type via
     * TypeScript's bivariant method-parameter checking. A caller holding this
     * instance through the DoGImplementation interface type (rather than the
     * concrete ADoG type) can only type-check overrides for fields that exist
     * on DoGConfig (sigma, k, epsilon, phi, ...) -- tau/s/noiseScaleC are only
     * overridable when the caller has a concrete ADoG reference. No data is
     * lost; this only affects what's type-checkable through the narrower view.
     */
    process(input: ChannelImage, overrides?: Partial<ADoGConfig>): Promise<ChannelImage>;
    processDetailed(input: ChannelImage, overrides?: Partial<ADoGConfig>): Promise<ADoGProcessingResult>;
    /**
     * Convenience method to process ImageData directly (e.g., from a canvas),
     * matching XDoG/FDoG's convenience method of the same name.
     */
    processGrayscaleImageData(input: ImageData, overrides?: Partial<ADoGConfig>): Promise<ImageData>;
    /**
     * Get current configuration
     */
    getConfig(): Readonly<ADoGConfig>;
    /**
     * Update configuration
     */
    setConfig(config: Partial<ADoGConfig>): void;
    /** Eq. (5): rho(x) = tau + (1 - tau) * (1 - tanh(s * I(x))) */
    private computeRhoMap;
    /** Eq. (6): sigma(x) = c * (1 - tanh(s * I(x))); sampled noise ~ N(0,1) * sigma(x) added to I(x) */
    private injectAdaptiveNoise;
    /** Eq. (3)/(4): ADoG(x) = G_sigmaC(x) - rho(x) * G_sigmaS(x) */
    private computeWeightedDoG;
    /** Standard (non-adaptive) DoG: G_sigmaC(x) - G_sigmaS(x), i.e. rho == 1 everywhere */
    private computeUnweightedDoG;
}
/**
 * Convenience function for one-shot ADoG processing, matching xdog()/fdog()
 * in dog.ts
 */
export declare function adog(input: ChannelImage, config?: Partial<ADoGConfig>): Promise<ChannelImage>;
//# sourceMappingURL=adog.d.ts.map