/**
 * WebGL-accelerated blur strategies
 */
import { GrayscaleImage, FlowField } from './types.js';
import { BlurStrategy } from './blur.js';
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
 * WebGL-accelerated isotropic Gaussian blur
 * Uses separable convolution with two passes (horizontal + vertical)
 */
export declare class WebGLIsotropicBlur implements BlurStrategy {
    private config;
    private resources;
    private currentWidth;
    private currentHeight;
    private framebuffer;
    private textures;
    /**
     * Check if WebGL is supported in the current environment
     */
    static isSupported(): boolean;
    /**
     * Get reason if WebGL is not supported
     */
    static getUnsupportedReason(): string | undefined;
    constructor(config?: Partial<WebGLBlurConfig>);
    /**
     * Initialize WebGL resources lazily
     */
    private initResources;
    /**
     * Ensure textures and framebuffer are sized correctly
     */
    private ensureTextureSize;
    /**
     * Run a blur pass with the given program
     */
    private runBlurPass;
    blur(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage>;
    blurAsync(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage>;
    /**
     * Clean up WebGL resources
     */
    dispose(): void;
}
/**
 * WebGL-accelerated flow-guided blur
 * Uses line integral convolution along edge tangent directions
 */
export declare class WebGLFlowGuidedBlur implements BlurStrategy {
    private config;
    private flowField;
    private resources;
    private currentWidth;
    private currentHeight;
    private framebuffer;
    private textures;
    private flowTexture;
    static isSupported(): boolean;
    static getUnsupportedReason(): string | undefined;
    constructor(flowField: FlowField, config?: Partial<WebGLBlurConfig>);
    private initResources;
    private ensureTextureSize;
    blur(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage>;
    blurAsync(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage>;
    dispose(): void;
}
//# sourceMappingURL=blur-webgl.d.ts.map