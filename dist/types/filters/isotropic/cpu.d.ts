/**
 * Blur strategies for DoG processing
 *
 * Provides both isotropic (standard) and anisotropic (flow-guided) blur
 * implementations for use in XDoG and FDoG pipelines.
 *
 * Supports parallel/concurrent blur operations
 */
import { type ChannelImage, type EdgeAwareFilterCore, type IsotropicBlurConfig } from '../../interfaces/base.js';
import { BaseCPUStrategy } from '../../base.js';
/**
 * Standard isotropic Gaussian blur using separable convolution
 * This is the blur used in basic XDoG
 */
export declare class CPUIsotropicFilter extends BaseCPUStrategy implements EdgeAwareFilterCore<IsotropicBlurConfig> {
    /** CPU is always available */
    static isSupported(): Promise<boolean>;
    dispose(): void;
    apply(input: ChannelImage, config: IsotropicBlurConfig): Promise<ChannelImage>;
}
//# sourceMappingURL=cpu.d.ts.map