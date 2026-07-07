/**
 * Flow-guided blur using line integral convolution along edge tangents
 * This is the blur used in FDoG for coherent line drawing
 *
 * The blur is computed by integrating pixel values along the flow direction,
 * weighted by a Gaussian kernel. This produces blur that follows edge contours
 * rather than blurring across them.
 */
import type { BlurStrategy, ChannelImage, FlowField } from '../types';
import { BaseCPUBlur, BaseWebGLBlur, BaseWebGPUBlur } from './base';
interface FlowGuidedBlurStrategy {
    setFlowField(flowField: FlowField): void;
}
/**
 * Configuration for flow-guided blur
 */
export interface CPUFlowGuidedBlurConfig {
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
export declare class CPUFlowGuidedBlur extends BaseCPUBlur implements BlurStrategy, FlowGuidedBlurStrategy {
    private flowField;
    private config;
    constructor(flowField: FlowField, config?: Partial<CPUFlowGuidedBlurConfig>);
    /**
     * Update the flow field (e.g., when processing a new image)
     */
    setFlowField(flowField: FlowField): void;
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    /**
     * Sample along the flow direction using line integral convolution
     *
     * This follows the tangent field in both directions from the starting point,
     * accumulating weighted samples to produce a blur along the edge direction.
     */
    private sampleAlongFlow;
}
/**
 * Configuration for WebGL blur
 */
export interface GLGPUBlurConfig {
    /** Kernel size multiplier relative to sigma (default: 6) */
    kernelSizeMultiplier: number;
    /** Maximum kernel size (default: 63, limited by shader uniform array) */
    maxKernelSize: number;
}
/**
 * WebGL2-accelerated flow-guided blur
 * Uses line integral convolution along edge tangent directions
 */
export declare class WebGLFlowGuidedBlur extends BaseWebGLBlur implements BlurStrategy, FlowGuidedBlurStrategy {
    private config;
    private flowField;
    private resources;
    private currentWidth;
    private currentHeight;
    private framebuffer;
    private textures;
    private flowTexture;
    constructor(flowField: FlowField, config?: Partial<GLGPUBlurConfig>);
    private initResources;
    private ensureTextureSize;
    /**
     * Update the flow field (e.g., when processing a new image)
     */
    setFlowField(flowField: FlowField): void;
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    dispose(): void;
}
/**
 * Configuration for WebGPU blur
 */
export interface GLGPUBlurConfig {
    /** Kernel size multiplier relative to sigma (default: 6) */
    kernelSizeMultiplier: number;
    /** Maximum kernel size (default: 127) */
    maxKernelSize: number;
}
/**
 * WebGPU-accelerated flow-guided blur
 */
export declare class WebGPUFlowGuidedBlur extends BaseWebGPUBlur implements BlurStrategy, FlowGuidedBlurStrategy {
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
    constructor(flowField: FlowField, config?: Partial<GLGPUBlurConfig>);
    private initResources;
    private ensureBuffers;
    /**
     * Update the flow field (e.g., when processing a new image)
     */
    setFlowField(flowField: FlowField): void;
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    dispose(): void;
}
export type FlowGuidedBlurConfig = CPUFlowGuidedBlurConfig | GLGPUBlurConfig;
export declare class FlowGuidedBlur implements BlurStrategy {
    instance: BlurStrategy & FlowGuidedBlurStrategy;
    constructor(flowField: FlowField, config?: Partial<FlowGuidedBlurConfig>);
    dispose(): void;
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    /**
     * Update the flow field (e.g., when processing a new image)
     */
    setFlowField(flowField: FlowField): void;
}
export {};
//# sourceMappingURL=flow-guided.d.ts.map