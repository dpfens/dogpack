/**
 * Blur strategies for DoG processing
 *
 * Provides both isotropic (standard) and anisotropic (flow-guided) blur
 * implementations for use in XDoG and FDoG pipelines.
 */
import { createGrayscaleImage, getPixel, getPixelBilinear, generateGaussianKernel, computeKernelSize } from './utils.js';
const DEFAULT_ISOTROPIC_CONFIG = {
    kernelSizeMultiplier: 6,
};
const DEFAULT_FLOW_CONFIG = {
    kernelSizeMultiplier: 6,
    stepSize: 1.0,
};
/**
 * Standard isotropic Gaussian blur using separable convolution
 * This is the blur used in basic XDoG
 */
export class IsotropicBlur {
    config;
    /**
     * Check if isotropic blur is supported
     * Always returns true as this is a pure JavaScript implementation
     */
    static isSupported() {
        return true;
    }
    /**
     * Get reason if unsupported (always undefined for this implementation)
     */
    static getUnsupportedReason() {
        return undefined;
    }
    constructor(config = {}) {
        this.config = { ...DEFAULT_ISOTROPIC_CONFIG, ...config };
    }
    async blur(input, sigma) {
        if (sigma < 0.1) {
            // For very small sigma, just return a copy
            return {
                data: new Float32Array(input.data),
                width: input.width,
                height: input.height,
            };
        }
        // Compute kernel size (odd number)
        const kernelSize = computeKernelSize(sigma, this.config.kernelSizeMultiplier);
        const kernel = generateGaussianKernel(sigma, kernelSize);
        const halfKernel = Math.floor(kernelSize / 2);
        // Separable convolution: horizontal pass
        const temp = createGrayscaleImage(input.width, input.height);
        for (let y = 0; y < input.height; y++) {
            for (let x = 0; x < input.width; x++) {
                let sum = 0;
                for (let k = 0; k < kernelSize; k++) {
                    const sampleX = x + k - halfKernel;
                    sum += getPixel(input, sampleX, y) * kernel[k];
                }
                temp.data[y * input.width + x] = sum;
            }
        }
        // Separable convolution: vertical pass
        const output = createGrayscaleImage(input.width, input.height);
        for (let y = 0; y < input.height; y++) {
            for (let x = 0; x < input.width; x++) {
                let sum = 0;
                for (let k = 0; k < kernelSize; k++) {
                    const sampleY = y + k - halfKernel;
                    sum += getPixel(temp, x, sampleY) * kernel[k];
                }
                output.data[y * input.width + x] = sum;
            }
        }
        return output;
    }
}
/**
 * Flow-guided blur using line integral convolution along edge tangents
 * This is the blur used in FDoG for coherent line drawing
 *
 * The blur is computed by integrating pixel values along the flow direction,
 * weighted by a Gaussian kernel. This produces blur that follows edge contours
 * rather than blurring across them.
 */
export class FlowGuidedBlur {
    flowField;
    config;
    /**
     * Check if flow-guided blur is supported
     * Always returns true as this is a pure JavaScript implementation
     */
    static isSupported() {
        return true;
    }
    /**
     * Get reason if unsupported (always undefined for this implementation)
     */
    static getUnsupportedReason() {
        return undefined;
    }
    constructor(flowField, config = {}) {
        this.flowField = flowField;
        this.config = { ...DEFAULT_FLOW_CONFIG, ...config };
    }
    /**
     * Update the flow field (e.g., when processing a new image)
     */
    setFlowField(flowField) {
        this.flowField = flowField;
    }
    async blur(input, sigma) {
        if (sigma < 0.1) {
            return {
                data: new Float32Array(input.data),
                width: input.width,
                height: input.height,
            };
        }
        const output = createGrayscaleImage(input.width, input.height);
        // Number of samples along the flow line
        // Paper samples at 2× sigma in each direction
        const halfSamples = Math.ceil(sigma * 2 / this.config.stepSize);
        const numSamples = halfSamples * 2 + 1;
        // Generate 1D Gaussian weights
        const weights = generateGaussianKernel(sigma, numSamples);
        for (let y = 0; y < input.height; y++) {
            for (let x = 0; x < input.width; x++) {
                const value = this.sampleAlongFlow(input, x, y, halfSamples, weights);
                output.data[y * input.width + x] = value;
            }
        }
        return output;
    }
    /**
     * Sample along the flow direction using line integral convolution
     *
     * This follows the tangent field in both directions from the starting point,
     * accumulating weighted samples to produce a blur along the edge direction.
     */
    sampleAlongFlow(input, startX, startY, halfSamples, weights) {
        const numSamples = weights.length;
        const stepSize = this.config.stepSize;
        let sum = 0;
        let weightSum = 0;
        // Sample at center (index = halfSamples)
        sum += getPixelBilinear(input, startX, startY) * weights[halfSamples];
        weightSum += weights[halfSamples];
        // Sample in positive flow direction
        let px = startX;
        let py = startY;
        for (let i = 1; i <= halfSamples; i++) {
            // Step along flow
            const tangent = this.flowField.getTangent(Math.round(px), Math.round(py));
            px += tangent.x * stepSize;
            py += tangent.y * stepSize;
            // Bounds check (with tolerance for interpolation)
            if (px < -0.5 || px > input.width - 0.5 ||
                py < -0.5 || py > input.height - 0.5) {
                break;
            }
            const idx = halfSamples + i;
            const value = getPixelBilinear(input, px, py);
            sum += value * weights[idx];
            weightSum += weights[idx];
        }
        // Sample in negative flow direction
        px = startX;
        py = startY;
        for (let i = 1; i <= halfSamples; i++) {
            // Step against flow
            const tangent = this.flowField.getTangent(Math.round(px), Math.round(py));
            px -= tangent.x * stepSize;
            py -= tangent.y * stepSize;
            // Bounds check
            if (px < -0.5 || px > input.width - 0.5 ||
                py < -0.5 || py > input.height - 0.5) {
                break;
            }
            const idx = halfSamples - i;
            const value = getPixelBilinear(input, px, py);
            sum += value * weights[idx];
            weightSum += weights[idx];
        }
        return weightSum > 0 ? sum / weightSum : 0;
    }
}
/**
 * Gradient-aligned blur for FDoG
 *
 * This applies blur perpendicular to the flow direction (across edges).
 * Used for the DoG computation in FDoG, where we want to blur across
 * edges but not along them.
 */
export class GradientAlignedBlur {
    flowField;
    config;
    static isSupported() {
        return true;
    }
    static getUnsupportedReason() {
        return undefined;
    }
    constructor(flowField, config = {}) {
        this.flowField = flowField;
        this.config = { ...DEFAULT_FLOW_CONFIG, ...config };
    }
    setFlowField(flowField) {
        this.flowField = flowField;
    }
    async blur(input, sigma) {
        if (sigma < 0.1) {
            return {
                data: new Float32Array(input.data),
                width: input.width,
                height: input.height,
            };
        }
        const output = createGrayscaleImage(input.width, input.height);
        // Number of samples perpendicular to flow
        const halfSamples = Math.ceil(sigma * 2 / this.config.stepSize);
        const numSamples = halfSamples * 2 + 1;
        const weights = generateGaussianKernel(sigma, numSamples);
        for (let y = 0; y < input.height; y++) {
            for (let x = 0; x < input.width; x++) {
                const value = this.sampleAcrossFlow(input, x, y, halfSamples, weights);
                output.data[y * input.width + x] = value;
            }
        }
        return output;
    }
    /**
     * Sample perpendicular to the flow direction
     */
    sampleAcrossFlow(input, startX, startY, halfSamples, weights) {
        const stepSize = this.config.stepSize;
        let sum = 0;
        let weightSum = 0;
        // Get perpendicular direction (gradient direction)
        const tangent = this.flowField.getTangent(startX, startY);
        const gradX = -tangent.y; // Perpendicular: rotate 90 degrees
        const gradY = tangent.x;
        // Sample at center
        sum += getPixelBilinear(input, startX, startY) * weights[halfSamples];
        weightSum += weights[halfSamples];
        // Sample in positive gradient direction
        for (let i = 1; i <= halfSamples; i++) {
            const px = startX + gradX * stepSize * i;
            const py = startY + gradY * stepSize * i;
            if (px < -0.5 || px > input.width - 0.5 ||
                py < -0.5 || py > input.height - 0.5) {
                break;
            }
            const idx = halfSamples + i;
            sum += getPixelBilinear(input, px, py) * weights[idx];
            weightSum += weights[idx];
        }
        // Sample in negative gradient direction
        for (let i = 1; i <= halfSamples; i++) {
            const px = startX - gradX * stepSize * i;
            const py = startY - gradY * stepSize * i;
            if (px < -0.5 || px > input.width - 0.5 ||
                py < -0.5 || py > input.height - 0.5) {
                break;
            }
            const idx = halfSamples - i;
            sum += getPixelBilinear(input, px, py) * weights[idx];
            weightSum += weights[idx];
        }
        return weightSum > 0 ? sum / weightSum : 0;
    }
}
/**
 * Two-pass FDoG blur: gradient-aligned DoG followed by flow-aligned smoothing
 *
 * This implements the full FDoG blur strategy as described in Section 2.6:
 * 1. Apply DoG across edges (gradient-aligned)
 * 2. Smooth the result along edges (flow-aligned)
 */
export class FDoGBlur {
    gradientBlur;
    flowBlur;
    sigmaM;
    static isSupported() {
        return true;
    }
    static getUnsupportedReason() {
        return undefined;
    }
    /**
     * @param flowField Edge tangent flow field
     * @param sigmaM Flow-aligned smoothing sigma (σm from paper)
     * @param config Additional configuration
     */
    constructor(flowField, sigmaM, config = {}) {
        this.gradientBlur = new GradientAlignedBlur(flowField, config);
        this.flowBlur = new FlowGuidedBlur(flowField, config);
        this.sigmaM = sigmaM;
    }
    setFlowField(flowField) {
        this.gradientBlur.setFlowField(flowField);
        this.flowBlur.setFlowField(flowField);
    }
    setSigmaM(sigmaM) {
        this.sigmaM = sigmaM;
    }
    /**
     * Apply the two-pass FDoG blur
     * @param input Source image
     * @param sigma Edge detection sigma (σe) - applied perpendicular to edges
     */
    async blur(input, sigma) {
        // Pass 1: Gradient-aligned blur (across edges)
        const gradientBlurred = await this.gradientBlur.blur(input, sigma);
        // Pass 2: Flow-aligned blur (along edges)
        const flowBlurred = await this.flowBlur.blur(gradientBlurred, this.sigmaM);
        return flowBlurred;
    }
    /**
     * Apply only gradient-aligned blur (for DoG computation)
     */
    async blurGradientAligned(input, sigma) {
        return this.gradientBlur.blur(input, sigma);
    }
    /**
     * Apply only flow-aligned blur (for post-processing/anti-aliasing)
     */
    async blurFlowAligned(input, sigma) {
        return this.flowBlur.blur(input, sigma);
    }
}
//# sourceMappingURL=blur.js.map