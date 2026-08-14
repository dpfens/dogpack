/**
 * High-level ADog implementations
 *
 * These classes provide convenient wrappers that compose the blur strategies
 * and DoG processor together.
 */
import { type ChannelImage } from '../interfaces/base.js';
import { type ADoGConfig, type ADoGProcessingResult, type DoGImplementation, type ParamRange } from '../interfaces/dog.js';
export declare class ADoG implements DoGImplementation {
    private config;
    private blurStrategy;
    constructor(config?: Partial<ADoGConfig>);
    dispose(): void;
    /**
     * Analytical epsilon ceiling for a given tau: beyond this, no flat
     * region (however bright) can cross threshold, and the output floods
     * to solid black regardless of image content. Pure function of tau,
     * so it's sync and doesn't need an input image or a processor instance.
     */
    static getEpsilonCeiling(tau: number): number;
    /**
     * Runs the pipeline once and returns mean/std of the pre-threshold
     * sharpened response, plus the tau-derived ceiling. Shared by
     * estimateEpsilon() and getEpsilonRange() so they don't each pay for
     * their own processDetailed() pass.
     */
    private static computeEpsilonStats;
    /**
     * Recommended [min, max] band for the epsilon slider, plus a sensible
     * default, derived from the actual image + config rather than the
     * static ADOG_PARAM_RANGES.epsilon entry (which can't account for
     * tau/s/noiseScaleC/image content).
     */
    static getEpsilonRange(input: ChannelImage, config?: Partial<ADoGConfig>, spread?: number): Promise<ParamRange>;
    /** Existing method, now built on computeEpsilonStats. */
    static estimateEpsilon(input: ChannelImage, config?: Partial<ADoGConfig>, biasOffset?: number): Promise<number>;
    /**
     * Analytical epsilon ceiling for a given tau: beyond this, no flat
     * region (however bright) can cross threshold, and the output floods
     * to solid black regardless of image content. Pure function of tau,
     * so it's sync and doesn't need an input image or a processor instance.
     */
    static getEpsilonMax(tau: number): number;
    static estimateSigma(input: ChannelImage, { referenceDimension, baseSigma }?: {
        referenceDimension?: number;
        baseSigma?: number;
    }): number;
    /**
     * Process a grayscale image through the ADoG pipeline.
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
    setConfig(config: Partial<ADoGConfig>): Promise<void>;
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