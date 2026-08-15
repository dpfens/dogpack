import { BaseWebGPUStrategy } from "../../base.js";
import { type ChannelImage, type EdgeAwareFilterCore, type IsotropicBlurConfig } from "../../interfaces/base.js";
/**
 * WebGPU-accelerated isotropic Gaussian blur
 * Uses compute shaders with separable convolution
 *
 * Supports concurrent/parallel blur calls by creating
 * separate staging buffers for each operation instead of reusing one.
 */
export declare class WebGPUIsotropicFilter extends BaseWebGPUStrategy implements EdgeAwareFilterCore<IsotropicBlurConfig> {
    private resources;
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
    apply(input: ChannelImage, config: IsotropicBlurConfig): Promise<ChannelImage>;
    /**
     * dispose() no longer needs to clean up shared buffers -- only the
     * cached pipeline/layout resources from initResources() remain.
     */
    dispose(): void;
}
//# sourceMappingURL=webgpu.d.ts.map