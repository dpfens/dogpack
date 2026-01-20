/**
 * WebGPU-accelerated blur strategies
 */
import { GrayscaleImage, FlowField } from './types';
import { BlurStrategy } from './blur';
/**
 * Configuration for WebGPU blur
 */
export interface WebGPUBlurConfig {
    /** Kernel size multiplier relative to sigma (default: 6) */
    kernelSizeMultiplier: number;
    /** Maximum kernel size (default: 127) */
    maxKernelSize: number;
}
/**
 * WebGPU-accelerated isotropic Gaussian blur
 * Uses compute shaders with separable convolution
 */
export declare class WebGPUIsotropicBlur implements BlurStrategy {
    private config;
    private resources;
    private initPromise;
    private paramsBuffer;
    private kernelBuffer;
    private inputBuffer;
    private tempBuffer;
    private outputBuffer;
    private stagingBuffer;
    private currentBufferSize;
    private currentKernelSize;
    /**
     * Check if WebGPU is supported
     */
    static isSupported(): boolean;
    /**
     * Get reason if WebGPU is not supported
     */
    static getUnsupportedReason(): string | undefined;
    /**
     * Async check if WebGPU is actually usable (adapter + device available)
     */
    static isAvailable(): Promise<boolean>;
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
     * Blur implementation - must be called with await
     */
    blur(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage>;
    /**
     * Clean up GPU resources
     */
    dispose(): void;
}
/**
 * WebGPU-accelerated flow-guided blur
 */
export declare class WebGPUFlowGuidedBlur implements BlurStrategy {
    private config;
    private flowField;
    private resources;
    private paramsBuffer;
    private kernelBuffer;
    private inputBuffer;
    private flowBuffer;
    private outputBuffer;
    private stagingBuffer;
    private currentBufferSize;
    private currentKernelSize;
    static isSupported(): boolean;
    static getUnsupportedReason(): string | undefined;
    static isAvailable(): Promise<boolean>;
    constructor(flowField: FlowField, config?: Partial<WebGPUBlurConfig>);
    private initResources;
    private ensureBuffers;
    blur(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage>;
    dispose(): void;
}
//# sourceMappingURL=blur-webgpu.d.ts.map