/**
 * Blur strategies for DoG processing
 *
 * Provides both isotropic (standard) and anisotropic (flow-guided) blur
 * implementations for use in XDoG and FDoG pipelines.
 *
 * FIXED: WebGPUIsotropicBlur now supports parallel/concurrent blur operations
 */
import { BlurStrategy, ChannelImage } from '../types.js';
import { BaseCPUBlur, BaseWebGLBlur, BaseWebGPUBlur } from './base.js';
/**
 * Configuration for isotropic Gaussian blur
 */
export interface BaseIsotropicBlurConfig {
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
export declare class CPUIsotropicBlur extends BaseCPUBlur implements BlurStrategy {
    private config;
    constructor(config?: Partial<BaseIsotropicBlurConfig>);
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
}
/**
 * Configuration for WebGL blur
 */
export interface WebGLBlurConfig {
    /** Kernel size multiplier relative to sigma (default: 6) */
    kernelSizeMultiplier: number;
    /** Maximum kernel size (default: 63, limited by shader uniform array) */
    maxKernelSize: number;
}
/**
 * WebGL2-accelerated isotropic Gaussian blur
 * Uses separable convolution with two passes (horizontal + vertical)
 */
export declare class WebGLIsotropicBlur extends BaseWebGLBlur implements BlurStrategy {
    private config;
    private resources;
    private currentWidth;
    private currentHeight;
    private framebuffer;
    private textures;
    constructor(config?: Partial<WebGLBlurConfig>);
    private initResources;
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    private blurPass;
    dispose(): void;
}
/**
 * WebGPU configuration
 */
export interface WebGPUBlurConfig {
    /** Kernel size multiplier relative to sigma (default: 6) */
    kernelSizeMultiplier: number;
    /** Maximum kernel size (default: 63) */
    maxKernelSize: number;
}
/**
 * WebGPU-accelerated isotropic Gaussian blur
 * Uses compute shaders with separable convolution
 *
 * FIXED: Now supports concurrent/parallel blur calls by creating
 * separate staging buffers for each operation instead of reusing one.
 */
export declare class WebGPUIsotropicBlur extends BaseWebGPUBlur implements BlurStrategy {
    private config;
    private resources;
    private initPromise;
    private paramsBuffer;
    private kernelBuffer;
    private inputBuffer;
    private tempBuffer;
    private outputBuffer;
    private currentBufferSize;
    private currentKernelSize;
    constructor(config?: Partial<WebGPUBlurConfig>);
    /**
     * Initialize WebGPU resources
     */
    private initResources;
    /**
     * Ensure buffers are sized correctly
     */
    private ensureBuffers;
    /**
     * Blur implementation - supports concurrent/parallel calls
     *
     * KEY FIX: Creates a new staging buffer for each operation instead of
     * reusing a single one. This prevents "Buffer already has an outstanding
     * map pending" errors when blur() is called in parallel.
     */
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    /**
     * Clean up GPU resources
     */
    dispose(): void;
}
export type IsotropicBlurConfig = BaseIsotropicBlurConfig | WebGLBlurConfig | WebGPUBlurConfig;
export declare class IsotropicBlur implements BlurStrategy {
    instance: BlurStrategy;
    constructor(config: Partial<IsotropicBlurConfig>);
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
}
//# sourceMappingURL=isotropic.d.ts.map