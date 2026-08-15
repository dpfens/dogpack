/**
 * WebGL-Accelerated Preprocessing Module for XDoG/FDoG
 *
 * High-performance GPU implementations of image preprocessing filters.
 * Achieves 50-100x speedup over CPU implementations for large images.
 */
import { type ChannelImage, type BilateralFilterConfig, type MedianFilterConfig, type KuwaharaFilterConfig, type EdgeAwareFilterCore, type GaussianConfig, type ContrastEnhancementConfig, type QuantizerConfig } from '../interfaces/base.js';
import { BaseWebGLStrategy } from '../base.js';
export declare class BilateralFilterWebGL extends BaseWebGLStrategy implements EdgeAwareFilterCore<BilateralFilterConfig> {
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    apply(input: ChannelImage, config: Partial<BilateralFilterConfig>): Promise<ChannelImage>;
}
export declare class GaussianBlurWebGL extends BaseWebGLStrategy implements EdgeAwareFilterCore<GaussianConfig> {
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    apply(input: ChannelImage, config: Partial<GaussianConfig>): Promise<ChannelImage>;
}
export declare class MedianFilterWebGL extends BaseWebGLStrategy implements EdgeAwareFilterCore<MedianFilterConfig> {
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    apply(input: ChannelImage, config?: Partial<MedianFilterConfig>): Promise<ChannelImage>;
}
export declare class KuwaharaFilterWebGL extends BaseWebGLStrategy implements EdgeAwareFilterCore<KuwaharaFilterConfig> {
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    apply(input: ChannelImage, config?: Partial<KuwaharaFilterConfig>): Promise<ChannelImage>;
}
export declare class ContrastEnhancerWebGL extends BaseWebGLStrategy implements EdgeAwareFilterCore<ContrastEnhancementConfig> {
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    apply(input: ChannelImage, config: Partial<ContrastEnhancementConfig>): Promise<ChannelImage>;
}
export declare class QuantizerWebGL extends BaseWebGLStrategy implements EdgeAwareFilterCore<QuantizerConfig> {
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    apply(input: ChannelImage, config: Partial<QuantizerConfig>): Promise<ChannelImage>;
}
/**
 * Check if WebGL 2.0 is available
 */
export declare function isWebGLAvailable(): boolean;
/**
 * Cleanup all WebGL resources
 */
export declare function disposeWebGL(): void;
export { BilateralFilterWebGL as BilateralFilter, MedianFilterWebGL as MedianFilter, KuwaharaFilterWebGL as KuwaharaFilter, GaussianBlurWebGL as GaussianBlur, ContrastEnhancerWebGL as ContrastEnhancer, QuantizerWebGL as Quantizer };
//# sourceMappingURL=webgl.d.ts.map