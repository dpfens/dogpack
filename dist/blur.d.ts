/**
 * Blur strategies for DoG processing
 */
import { GrayscaleImage, FlowField } from './types.js';
/**
 * Abstract blur strategy interface
 * Implementations provide different blur algorithms (isotropic, flow-guided, etc.)
 */
export interface BlurStrategy {
    /**
     * Apply blur to an image with the given sigma (synchronous)
     * Note: May throw on GPU implementations that require async
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
    /** Kernel size multiplier relative to sigma (default: 6, meaning 3σ on each side) */
    kernelSizeMultiplier: number;
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
 */
export declare class FlowGuidedBlur implements BlurStrategy {
    private flowField;
    /**
     * Check if flow-guided blur is supported
     * Always returns true as this is a pure JavaScript implementation
     */
    static isSupported(): boolean;
    /**
     * Get reason if unsupported (always undefined for this implementation)
     */
    static getUnsupportedReason(): string | undefined;
    constructor(flowField: FlowField);
    blur(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage>;
    /**
     * Sample along the flow direction using line integral convolution
     */
    private sampleAlongFlow;
    /**
     * Bilinear interpolation for sub-pixel sampling
     */
    private bilinearSample;
}
//# sourceMappingURL=blur.d.ts.map