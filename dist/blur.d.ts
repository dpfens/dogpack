/**
 * Blur strategies for DoG processing
 *
 * Provides both isotropic (standard) and anisotropic (flow-guided) blur
 * implementations for use in XDoG and FDoG pipelines.
 */
import { GrayscaleImage, FlowField } from './types.js';
/**
 * Abstract blur strategy interface
 * Implementations provide different blur algorithms (isotropic, flow-guided, etc.)
 */
export interface BlurStrategy {
    /**
     * Apply blur to an image with the given sigma
     * @param input Source image
     * @param sigma Blur radius (standard deviation)
     * @returns Blurred image
     */
    blur(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage>;
}
/**
 * Static interface for blur strategy classes
 * Used to check runtime availability before instantiation
 */
export interface BlurStrategyClass {
    /**
     * Check if this blur strategy is supported in the current environment
     * @returns true if the strategy can be used, false otherwise
     */
    isSupported(): boolean;
    /**
     * Get a human-readable reason if the strategy is not supported
     * @returns undefined if supported, or a string explaining why it's not
     */
    getUnsupportedReason?(): string | undefined;
}
/**
 * Configuration for isotropic Gaussian blur
 */
export interface IsotropicBlurConfig {
    /**
     * Kernel size multiplier relative to sigma (default: 6, meaning 3σ on each side)
     * Paper samples at 2× sigma for flow-aligned, 2.45× for structure tensor
     */
    kernelSizeMultiplier: number;
}
/**
 * Configuration for flow-guided blur
 */
export interface FlowGuidedBlurConfig {
    /**
     * Kernel size multiplier for flow-aligned LIC (default: 6)
     */
    kernelSizeMultiplier: number;
    /**
     * Step size for line integral convolution (default: 1.0)
     * Smaller values give smoother integration but cost more
     */
    stepSize: number;
}
/**
 * Standard isotropic Gaussian blur using separable convolution
 * This is the blur used in basic XDoG
 */
export declare class IsotropicBlur implements BlurStrategy {
    private config;
    /**
     * Check if isotropic blur is supported
     * Always returns true as this is a pure JavaScript implementation
     */
    static isSupported(): boolean;
    /**
     * Get reason if unsupported (always undefined for this implementation)
     */
    static getUnsupportedReason(): string | undefined;
    constructor(config?: Partial<IsotropicBlurConfig>);
    blur(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage>;
}
/**
 * Flow-guided blur using line integral convolution along edge tangents
 * This is the blur used in FDoG for coherent line drawing
 *
 * The blur is computed by integrating pixel values along the flow direction,
 * weighted by a Gaussian kernel. This produces blur that follows edge contours
 * rather than blurring across them.
 */
export declare class FlowGuidedBlur implements BlurStrategy {
    private flowField;
    private config;
    /**
     * Check if flow-guided blur is supported
     * Always returns true as this is a pure JavaScript implementation
     */
    static isSupported(): boolean;
    /**
     * Get reason if unsupported (always undefined for this implementation)
     */
    static getUnsupportedReason(): string | undefined;
    constructor(flowField: FlowField, config?: Partial<FlowGuidedBlurConfig>);
    /**
     * Update the flow field (e.g., when processing a new image)
     */
    setFlowField(flowField: FlowField): void;
    blur(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage>;
    /**
     * Sample along the flow direction using line integral convolution
     *
     * This follows the tangent field in both directions from the starting point,
     * accumulating weighted samples to produce a blur along the edge direction.
     */
    private sampleAlongFlow;
}
/**
 * Gradient-aligned blur for FDoG
 *
 * This applies blur perpendicular to the flow direction (across edges).
 * Used for the DoG computation in FDoG, where we want to blur across
 * edges but not along them.
 */
export declare class GradientAlignedBlur implements BlurStrategy {
    private flowField;
    private config;
    static isSupported(): boolean;
    static getUnsupportedReason(): string | undefined;
    constructor(flowField: FlowField, config?: Partial<FlowGuidedBlurConfig>);
    setFlowField(flowField: FlowField): void;
    blur(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage>;
    /**
     * Sample perpendicular to the flow direction
     */
    private sampleAcrossFlow;
}
/**
 * Two-pass FDoG blur: gradient-aligned DoG followed by flow-aligned smoothing
 *
 * This implements the full FDoG blur strategy as described in Section 2.6:
 * 1. Apply DoG across edges (gradient-aligned)
 * 2. Smooth the result along edges (flow-aligned)
 */
export declare class FDoGBlur implements BlurStrategy {
    private gradientBlur;
    private flowBlur;
    private sigmaM;
    static isSupported(): boolean;
    static getUnsupportedReason(): string | undefined;
    /**
     * @param flowField Edge tangent flow field
     * @param sigmaM Flow-aligned smoothing sigma (σm from paper)
     * @param config Additional configuration
     */
    constructor(flowField: FlowField, sigmaM: number, config?: Partial<FlowGuidedBlurConfig>);
    setFlowField(flowField: FlowField): void;
    setSigmaM(sigmaM: number): void;
    /**
     * Apply the two-pass FDoG blur
     * @param input Source image
     * @param sigma Edge detection sigma (σe) - applied perpendicular to edges
     */
    blur(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage>;
    /**
     * Apply only gradient-aligned blur (for DoG computation)
     */
    blurGradientAligned(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage>;
    /**
     * Apply only flow-aligned blur (for post-processing/anti-aliasing)
     */
    blurFlowAligned(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage>;
}
//# sourceMappingURL=blur.d.ts.map