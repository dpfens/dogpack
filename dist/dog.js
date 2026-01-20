/**
 * Difference of Gaussians processor
 *
 * This is the core processor that can be used for both XDoG (with IsotropicBlur)
 * and FDoG (with FlowGuidedBlur).
 */
import { DEFAULT_DOG_CONFIG } from './types.js';
import { createGrayscaleImage } from './utils.js';
/**
 * Difference of Gaussians processor
 *
 * Computes D(x) = G_σ(x) - τ * G_kσ(x) and applies soft thresholding.
 *
 * The blur strategy can be swapped to get different effects:
 * - IsotropicBlur: Standard XDoG with uniform blur
 * - FlowGuidedBlur: FDoG with edge-coherent blur
 */
export class DoGProcessor {
    config;
    blurStrategy;
    constructor(blurStrategy, config = {}) {
        this.blurStrategy = blurStrategy;
        this.config = { ...DEFAULT_DOG_CONFIG, ...config };
    }
    /**
     * Process an image through the DoG pipeline
     *
     * @param input Grayscale input image (values in 0-1 range)
     * @param overrides Optional parameter overrides for this call
     * @returns Processed image with edges detected and stylized
     */
    async process(input, overrides = {}) {
        const params = { ...this.config, ...overrides };
        // Step 1: Apply two Gaussian blurs with different sigma values
        const blur1 = await this.blurStrategy.blur(input, params.sigma);
        const blur2 = await this.blurStrategy.blur(input, params.sigma * params.k);
        // Step 2: Compute difference of Gaussians
        const dog = this.computeDoG(blur1, blur2, params.tau);
        // Step 3: Apply soft thresholding
        const output = this.applyThreshold(dog, params.epsilon, params.phi);
        return output;
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Update configuration
     */
    setConfig(config) {
        this.config = { ...this.config, ...config };
    }
    /**
     * Replace blur strategy
     */
    setBlurStrategy(strategy) {
        this.blurStrategy = strategy;
    }
    /**
     * Compute difference of Gaussians: D(x) = G_σ(x) - τ * G_kσ(x)
     */
    computeDoG(blur1, blur2, tau) {
        const output = createGrayscaleImage(blur1.width, blur1.height);
        const size = blur1.width * blur1.height;
        for (let i = 0; i < size; i++) {
            output.data[i] = blur1.data[i] - tau * blur2.data[i];
        }
        return output;
    }
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
    applyThreshold(dog, epsilon, phi) {
        const output = createGrayscaleImage(dog.width, dog.height);
        const size = dog.width * dog.height;
        for (let i = 0; i < size; i++) {
            const d = dog.data[i];
            if (d >= epsilon) {
                output.data[i] = 1.0;
            }
            else {
                // Soft threshold with tanh
                // This creates a smooth transition to black for values below epsilon
                output.data[i] = 1.0 + Math.tanh(phi * (d - epsilon));
            }
        }
        return output;
    }
}
/**
 * Alternative thresholding modes that can be used for different effects
 */
export const ThresholdModes = {
    /**
     * Hard black and white threshold
     */
    hard: (value, epsilon) => {
        return value >= epsilon ? 1.0 : 0.0;
    },
    /**
     * Soft threshold (default XDoG style)
     */
    soft: (value, epsilon, phi) => {
        if (value >= epsilon)
            return 1.0;
        return 1.0 + Math.tanh(phi * (value - epsilon));
    },
    /**
     * Three-tone (white, gray, black) for sketch effect
     */
    threeTone: (value, epsilon, midPoint) => {
        if (value >= epsilon)
            return 1.0;
        if (value >= midPoint)
            return 0.5;
        return 0.0;
    },
    /**
     * Continuous (no thresholding) - useful for seeing raw DoG output
     */
    continuous: (value) => {
        return Math.max(0, Math.min(1, value + 0.5));
    },
};
//# sourceMappingURL=dog.js.map