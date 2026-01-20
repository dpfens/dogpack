/**
 * Difference of Gaussians processor
 *
 * This is the core processor that can be used for both XDoG (with IsotropicBlur)
 * and FDoG (with FlowGuidedBlur).
 */
import { GrayscaleImage, DoGConfig } from './types.js';
import { BlurStrategy } from './blur.js';
/**
 * Difference of Gaussians processor
 *
 * Computes D(x) = G_σ(x) - τ * G_kσ(x) and applies soft thresholding.
 *
 * The blur strategy can be swapped to get different effects:
 * - IsotropicBlur: Standard XDoG with uniform blur
 * - FlowGuidedBlur: FDoG with edge-coherent blur
 */
export declare class DoGProcessor {
    private config;
    private blurStrategy;
    constructor(blurStrategy: BlurStrategy, config?: Partial<DoGConfig>);
    /**
     * Process an image through the DoG pipeline
     *
     * @param input Grayscale input image (values in 0-1 range)
     * @param overrides Optional parameter overrides for this call
     * @returns Processed image with edges detected and stylized
     */
    process(input: GrayscaleImage, overrides?: Partial<DoGConfig>): Promise<GrayscaleImage>;
    /**
     * Get current configuration
     */
    getConfig(): Readonly<DoGConfig>;
    /**
     * Update configuration
     */
    setConfig(config: Partial<DoGConfig>): void;
    /**
     * Replace blur strategy
     */
    setBlurStrategy(strategy: BlurStrategy): void;
    /**
     * Compute difference of Gaussians: D(x) = G_σ(x) - τ * G_kσ(x)
     */
    private computeDoG;
    /**
     * Apply soft thresholding using tanh function
     *
     * For XDoG, this creates the characteristic black-and-white stylization.
     *
     * Output:
     *   1 (white)                    if DoG(x) >= epsilon
     *   1 + tanh(phi * (DoG(x) - epsilon))  otherwise
     *
     * The phi parameter controls the sharpness of the transition.
     */
    private applyThreshold;
}
/**
 * Alternative thresholding modes that can be used for different effects
 */
export declare const ThresholdModes: {
    /**
     * Hard black and white threshold
     */
    hard: (value: number, epsilon: number) => number;
    /**
     * Soft threshold (default XDoG style)
     */
    soft: (value: number, epsilon: number, phi: number) => number;
    /**
     * Three-tone (white, gray, black) for sketch effect
     */
    threeTone: (value: number, epsilon: number, midPoint: number) => number;
    /**
     * Continuous (no thresholding) - useful for seeing raw DoG output
     */
    continuous: (value: number) => number;
};
//# sourceMappingURL=dog.d.ts.map