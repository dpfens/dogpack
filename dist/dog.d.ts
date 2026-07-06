/**
 * Difference of Gaussians processor
 *
 * This is the core processor that can be used for both XDoG (with IsotropicBlur)
 * and FDoG (with FlowGuidedBlur).
 *
 * Implements the reparameterized formulation from Section 2.5 of:
 * "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 */
import { BlurStrategy, ChannelImage, DoGConfig, DoGProcessingResult } from './types.js';
/**
 * Difference of Gaussians processor
 *
 * Uses the reparameterized formulation (Equation 7):
 * S_σ,k,p(x) = G_σ(x) + p · D_σ,k(x) = (1 + p) · G_σ(x) - p · G_kσ(x)
 *
 * This is equivalent to unsharp masking of the blurred image, which
 * decouples edge sharpening strength (p) from threshold parameters.
 *
 * The blur strategy can be swapped to get different effects:
 * - IsotropicBlur: Standard XDoG with uniform blur
 * - FlowGuidedBlur: FDoG with edge-coherent blur
 * - GradientAlignedBlur: Blur across edges only
 */
export declare class DoGProcessor {
    private config;
    private blurStrategy;
    private thresholdStrategy;
    constructor(blurStrategy: BlurStrategy, config?: Partial<DoGConfig>);
    /**
     * Process an image through the DoG pipeline
     *
     * Pipeline:
     * 1. Apply two Gaussian blurs with different sigma values
     * 2. Compute sharpened image using Equation 7
     * 3. Apply soft thresholding using Equation 5
     *
     * @param input Grayscale input image (values in 0-1 range)
     * @param overrides Optional parameter overrides for this call
     * @returns Processed image with edges detected and stylized
     */
    process(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<ChannelImage>;
    /**
     * Process without thresholding - returns the sharpened image
     * Useful for debugging or custom post-processing
     */
    processNoThreshold(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<ChannelImage>;
    /**
     * Get the raw DoG response (without sharpening or thresholding)
     * Useful for visualization and debugging
     */
    processRawDoG(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<ChannelImage>;
    /**
     * Process and return all intermediate results in a single pass
     *
     * This is more efficient than calling process(), processNoThreshold(), and
     * processRawDoG() separately as it only performs the blur operations once.
     *
     * @param input Grayscale input image (values in 0-1 range)
     * @param overrides Optional parameter overrides for this call
     * @returns Object containing result, sharpened, and rawDoG images
     */
    processDetailed(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<DoGProcessingResult>;
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
     * Compute raw Difference of Gaussians: D(x) = G_σ(x) - G_kσ(x)
     * This is the standard DoG without any weighting
     */
    private computeDoG;
    /**
     * Compute sharpened image using Equation 7 from the paper:
     * S_σ,k,p(x) = G_σ(x) + p · D_σ,k(x) = (1 + p) · G_σ(x) - p · G_kσ(x)
     *
     * This can be understood as unsharp masking of the blurred image.
     * The parameter p controls the edge sharpening strength independently
     * of the threshold parameters.
     *
     * @param blur1 G_σ * I (smaller blur)
     * @param blur2 G_kσ * I (larger blur)
     * @param p Sharpening strength (p ≈ 20 typical, p ≈ 100 for woodcut)
     */
    private computeSharpening;
    /**
     * Apply thresholding using the configured strategy
     * This creates the characteristic XDoG stylization:
     * - Values above ε become white (1)
     * - Values below ε get soft-thresholded with tanh
     * - φ controls the sharpness of the transition
     *
     * @param sharpened Sharpened image from computeSharpening
     * @param epsilon Threshold value (typically around 0.5-0.8 for normalized images)
     * @param phi Threshold sharpness (0.01 = soft, 100 = near step function)
     */
    private applyThreshold;
}
/**
 * Alternative thresholding modes that can be used for different effects
 * These can be applied to the sharpened image manually for custom styles
 */
export declare const ThresholdModes: {
    /**
     * Hard black and white threshold (step function)
     * Equivalent to φ → ∞ in the soft threshold
     */
    hard: (value: number, epsilon: number) => number;
    /**
     * Soft threshold (default XDoG style, Equation 5)
     */
    soft: (value: number, epsilon: number, phi: number) => number;
    /**
     * Three-tone (white, gray, black) for sketch effect
     * Creates a posterized look with three distinct values
     */
    threeTone: (value: number, epsilon: number, midPoint?: number) => number;
    /**
     * Multi-tone quantization
     * Quantizes to n discrete levels
     */
    multiTone: (value: number, levels: number) => number;
    /**
     * Continuous (no thresholding) - useful for seeing raw sharpened output
     * Maps the range to 0-1 for visualization
     */
    continuous: (value: number) => number;
    /**
     * Smooth curve approximating three-value quantization
     * Used for Figure 7(c) in the paper
     */
    smoothThreeTone: (value: number, epsilon: number, phi: number) => number;
};
/**
 * Apply a custom threshold function to a grayscale image
 */
export declare function applyCustomThreshold(input: ChannelImage, thresholdFn: (value: number) => number): ChannelImage;
//# sourceMappingURL=dog.d.ts.map