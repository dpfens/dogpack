/**
 * Flow-guided blur using line integral convolution along edge tangents
 * This is the blur used in FDoG for coherent line drawing
 *
 * The blur is computed by integrating pixel values along the flow direction,
 * weighted by a Gaussian kernel. This produces blur that follows edge contours
 * rather than blurring across them.
 */
import type { BlurStrategy, ChannelImage, FlowField } from '../interfaces/base.js';
import { BaseCPUStrategy, BaseWebGLStrategy, BaseWebGPUStrategy } from '../base.js';
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
export declare class CPUFlowGuidedBlur extends BaseCPUStrategy implements BlurStrategy, FlowGuidedBlurStrategy {
    private flowField;
    private config;
    constructor(flowField: FlowField, config?: Partial<CPUFlowGuidedBlurConfig>);
    /** CPU is always available */
    static isSupported(): Promise<boolean>;
    dispose(): void;
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
export declare class WebGLFlowGuidedBlur extends BaseWebGLStrategy implements BlurStrategy, FlowGuidedBlurStrategy {
    private config;
    private flowField;
    private resources;
    private currentWidth;
    private currentHeight;
    private framebuffer;
    private textures;
    private flowTexture;
    constructor(flowField: FlowField, config?: Partial<GLGPUBlurConfig>);
    /**
     * Same check as WebGLIsotropicBlur: a real, hardware-accelerated WebGL2
     * context with float render targets, excluding software rasterizers.
     */
    static isSupported(): Promise<boolean>;
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
export declare class WebGPUFlowGuidedBlur extends BaseWebGPUStrategy implements BlurStrategy, FlowGuidedBlurStrategy {
    private config;
    private flowField;
    private resources;
    private kernelBuffer;
    private currentKernelSize;
    private flowTexture;
    private flowFieldWidth;
    private flowFieldHeight;
    private flowDirty;
    private static readonly CPU_BAKE_ROWS_PER_CHUNK;
    private maxTileBytes;
    private static readonly TILE_MEMORY_SAFETY_FACTOR;
    constructor(flowField: FlowField, config?: Partial<GLGPUBlurConfig>);
    /**
     * Confirms an adapter is actually obtainable, not just that
     * `navigator.gpu` exists as an API surface.
     */
    static isSupported(): Promise<boolean>;
    private initResources;
    /**
     * Textures are bound by maxTextureDimension2D (typically 8192-16384),
     * not the storage-buffer binding limit. That ceiling still exists,
     * and silently exceeding it is exactly the failure mode this fix is
     * closing off. Throw a clear, catchable error instead, so the
     * FlowGuidedBlur wrapper's fallback logic gets a chance to demote to
     * WebGL/CPU rather than the caller getting corrupted output.
     */
    private assertWithinTextureLimits;
    /**
     * (Re)builds the flow-field texture for the given dimensions if it's
     * missing, stale (setFlowField() was called), or the wrong size. Built
     * in row-chunks rather than one Float32Array(width*height*2) for the
     * whole image, so preparing this for a large image doesn't itself blow
     * up JS heap before any GPU work happens.
     */
    private bakeFlowTexture;
    private getFlowTexture;
    /**
     * Update the flow field (e.g., when processing a new image). Marks the
     * cached flow texture dirty rather than rebuilding immediately. The
     * next blur() call rebuilds it against the dimensions that call actually
     * needs.
     */
    setFlowField(flowField: FlowField): void;
    /**
     * MEMORY: the output/readback path is processed in row-band tiles
     * bounded by `maxTileBytes`, not one whole-image buffer
     */
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    dispose(): void;
}
export type FlowGuidedBlurConfig = CPUFlowGuidedBlurConfig | GLGPUBlurConfig;
/**
 * Backend-agnostic flow-guided blur. Same per-algorithm backend selection
 * and single-retry fallback as `IsotropicBlur`
 *
 * One addition here: the flow field is mutable,
 * so it has to be tracked on the wrapper too. A
 * fallback needs to construct the next backend with the *current* flow
 * field, not the one from construction time.
 */
export declare class FlowGuidedBlur implements BlurStrategy, FlowGuidedBlurStrategy {
    private instance;
    private currentCtor;
    private config;
    private flowField;
    private failedBackends;
    private constructor();
    private static readonly candidates;
    static create(flowField: FlowField, config?: Partial<FlowGuidedBlurConfig>): Promise<FlowGuidedBlur>;
    get backend(): "cpu" | "webgl" | "webgpu";
    dispose(): void;
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    /**
     * Update the flow field (e.g., when processing a new frame). Stored on
     * the wrapper too, so a later backend fallback hands the new instance
     * the current flow field rather than a stale one from construction time.
     */
    setFlowField(flowField: FlowField): void;
    private demoteAndFindNext;
}
export {};
//# sourceMappingURL=flow-guided.d.ts.map