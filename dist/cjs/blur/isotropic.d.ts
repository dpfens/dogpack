/**
 * Blur strategies for DoG processing
 *
 * Provides both isotropic (standard) and anisotropic (flow-guided) blur
 * implementations for use in XDoG and FDoG pipelines.
 *
 * Supports parallel/concurrent blur operations
 */
import type { BlurStrategy, ChannelImage } from '../interfaces/base.js';
import { BaseCPUStrategy, BaseWebGLStrategy, BaseWebGPUStrategy } from '../base.js';
/**
 * Configuration for isotropic Gaussian blur
 */
export interface BaseIsotropicBlurConfig {
    /**
     * Kernel size multiplier relative to sigma (default: 6, meaning 3 * sigma on each side)
     * Paper samples at 2x sigma for flow-aligned, 2.45x for structure tensor
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
export declare class CPUIsotropicBlur extends BaseCPUStrategy implements BlurStrategy {
    private config;
    constructor(config?: Partial<BaseIsotropicBlurConfig>);
    /** CPU is always available */
    static isSupported(): Promise<boolean>;
    dispose(): void;
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
export declare class WebGLIsotropicBlur extends BaseWebGLStrategy implements BlurStrategy {
    private config;
    private resources;
    constructor(config?: Partial<WebGLBlurConfig>);
    /**
     * Cheap synchronous-in-spirit check (wrapped in a resolved Promise to
     * satisfy `BlurStrategyCtor`) Excludes software
     * rasterizers, which are too slow to be a useful GPU fallback.
     */
    static isSupported(): Promise<boolean>;
    private initResources;
    /**
     * Textures and the framebuffer are allocated per-call (not cached on
     * `this`) so concurrent blur() calls on the same instance -- e.g.
     * DoGProcessor.process()'s Promise.all([blur(sigma), blur(sigma*k)]) --
     * never share mutable GPU state. Mirrors the pattern already used by
     * WebGPUIsotropicBlur. Always cleaned up in `finally`, even if a pass or
     * readback throws.
     */
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
 * Supports concurrent/parallel blur calls by creating
 * separate staging buffers for each operation instead of reusing one.
 */
export declare class WebGPUIsotropicBlur extends BaseWebGPUStrategy implements BlurStrategy {
    private config;
    private resources;
    constructor(config?: Partial<WebGPUBlurConfig>);
    /**
     * Confirms an adapter is actually obtainable, not just that
     * `navigator.gpu` exists as an API surface.
     */
    static isSupported(): Promise<boolean>;
    /**
     * Initialize WebGPU resources
     */
    private initResources;
    /**
     * Fix for WebGPUIsotropicBlur: allocate buffers per call instead of
     * reusing instance-level ones, so concurrent blur() calls (as issued by
     * DoGProcessor.process()'s Promise.all([blur(sigma), blur(sigma*k)]))
     * never share mutable GPU state. Mirrors the pattern already used by
     * WebGPUFlowGuidedBlur and WebGPUGradientAlignedBlur.
     *
     * Delete the old paramsBuffer/kernelBuffer/inputBuffer/tempBuffer/
     * outputBuffer/currentBufferSize/currentKernelSize instance fields and
     * ensureBuffers() method; they're no longer needed.
     */
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    /**
     * dispose() no longer needs to clean up shared buffers -- only the
     * cached pipeline/layout resources from initResources() remain.
     */
    dispose(): void;
}
export type IsotropicBlurConfig = BaseIsotropicBlurConfig | WebGLBlurConfig | WebGPUBlurConfig;
/**
 * Backend-agnostic isotropic blur. Picks the best backend this device
 * actually supports for *this algorithm* (not a global session-wide
 * choice), and falls back to the next-best backend if the active one
 * fails mid-session (lost context, driver crash, etc.).
 *
 * Construction is async (`IsotropicBlur.create()`) because backend
 * detection is inherently async; constructors can't be async, so a
 * private constructor plus a static factory forces detection to
 * complete before the instance is usable.
 */
export declare class IsotropicBlur implements BlurStrategy {
    private instance;
    private currentCtor;
    private config;
    private failedBackends;
    private constructor();
    private static readonly candidates;
    static create(config?: Partial<IsotropicBlurConfig>): Promise<IsotropicBlur>;
    get backend(): "cpu" | "webgl" | "webgpu";
    dispose(): void;
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    /**
     * Demotes the current backend and activates the next untried, supported
     * candidate. A single-step retry, not a cascading loop through every
     * remaining backend: cascading on one call risks masking a real input
     * bug (e.g. a bad sigma) as a backend problem.
     *
     * `failedBackends` is per-instance, not module-global so a transient
     * driver hiccup shouldn't permanently blacklist a backend for the whole
     * session.
     */
    private demoteAndFindNext;
}
//# sourceMappingURL=isotropic.d.ts.map