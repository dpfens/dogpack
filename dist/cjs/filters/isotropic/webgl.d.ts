/**
 * WebGL-Accelerated Preprocessing Module for XDoG/FDoG
 *
 * High-performance GPU implementations of image preprocessing filters.
 * Achieves 50-100x speedup over CPU implementations for large images.
 */
import { type ChannelImage, type EdgeAwareFilterCore, type GaussianConfig } from '../../interfaces/base.js';
import { BaseWebGLStrategy } from '../../base.js';
export declare class WebGLIsotropicFilter extends BaseWebGLStrategy implements EdgeAwareFilterCore<GaussianConfig> {
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    apply(input: ChannelImage, config: Partial<GaussianConfig>): Promise<ChannelImage>;
}
/**
 * Check if WebGL 2.0 is available
 */
export declare function isWebGLAvailable(): boolean;
/**
 * Cleanup all WebGL resources
 */
export declare function disposeWebGL(): void;
//# sourceMappingURL=webgl.d.ts.map