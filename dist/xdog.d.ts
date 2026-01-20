/**
 * High-level XDoG and FDoG implementations
 *
 * These classes provide convenient wrappers that compose the blur strategies
 * and DoG processor together.
 */
import { GrayscaleImage, DoGConfig, ETFConfig } from './types.js';
import { EdgeTangentFlow } from './etf.js';
/**
 * XDoG configuration combining DoG parameters with isotropic blur options
 */
export interface XDoGConfig extends DoGConfig {
    /** Kernel size multiplier for Gaussian blur (default: 6) */
    kernelSizeMultiplier?: number;
}
/**
 * FDoG configuration combining DoG parameters with ETF options
 */
export interface FDoGConfig extends DoGConfig {
    /** ETF refinement iterations (default: 3) */
    etfIterations?: number;
    /** ETF smoothing kernel size (default: 5) */
    etfKernelSize?: number;
}
/**
 * XDoG (Extended Difference of Gaussians)
 *
 * Uses standard isotropic Gaussian blur for edge detection and stylization.
 * Good for general-purpose edge detection and artistic effects.
 */
export declare class XDoG {
    private processor;
    private config;
    constructor(config?: Partial<XDoGConfig>);
    /**
     * Process a grayscale image
     */
    process(input: GrayscaleImage, overrides?: Partial<DoGConfig>): Promise<GrayscaleImage>;
    /**
     * Convenience method to process ImageData directly (e.g., from a canvas)
     */
    processImageData(input: ImageData, overrides?: Partial<DoGConfig>): Promise<ImageData>;
    /**
     * Get current configuration
     */
    getConfig(): Readonly<XDoGConfig>;
    /**
     * Update configuration
     */
    setConfig(config: Partial<XDoGConfig>): void;
}
/**
 * FDoG (Flow-based Difference of Gaussians)
 *
 * Uses flow-guided blur along edge tangent directions for coherent line drawing.
 * Produces smoother, more artistic results similar to hand-drawn illustrations.
 *
 * Note: FDoG is more computationally expensive than XDoG due to:
 * 1. Computing the Edge Tangent Flow field
 * 2. Line integral convolution for flow-guided blur
 */
export declare class FDoG {
    private config;
    constructor(config?: Partial<FDoGConfig>);
    /**
     * Process a grayscale image
     *
     * Unlike XDoG, FDoG computes a new flow field for each image,
     * so the processor is created fresh each time.
     */
    process(input: GrayscaleImage, overrides?: Partial<FDoGConfig>): Promise<GrayscaleImage>;
    /**
     * Convenience method to process ImageData directly
     */
    processImageData(input: ImageData, overrides?: Partial<FDoGConfig>): Promise<ImageData>;
    /**
     * Process with a pre-computed ETF
     *
     * Useful when processing multiple frames of video where the ETF
     * can be computed once and reused, or interpolated between keyframes.
     */
    processWithETF(input: GrayscaleImage, etf: EdgeTangentFlow, overrides?: Partial<DoGConfig>): Promise<GrayscaleImage>;
    /**
     * Compute Edge Tangent Flow separately
     *
     * Useful for visualizing the flow field or reusing it across frames.
     */
    computeETF(input: GrayscaleImage, overrides?: Partial<ETFConfig>): EdgeTangentFlow;
    /**
     * Get current configuration
     */
    getConfig(): Readonly<FDoGConfig>;
    /**
     * Update configuration
     */
    setConfig(config: Partial<FDoGConfig>): void;
}
//# sourceMappingURL=xdog.d.ts.map