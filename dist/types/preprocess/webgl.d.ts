/**
 * WebGL-Accelerated Preprocessing Module for XDoG/FDoG
 *
 * High-performance GPU implementations of image preprocessing filters.
 * Achieves 50-100x speedup over CPU implementations for large images.
 */
import type { ChannelImage, BilateralFilterConfig, MedianFilterConfig, KuwaharaFilterConfig, Preprocessor } from '../interfaces/base.js';
import { BaseWebGLStrategy } from '../base.js';
export declare class BilateralFilterWebGL extends BaseWebGLStrategy implements Preprocessor {
    private readonly config;
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    constructor(config?: Partial<BilateralFilterConfig>);
    process(input: ChannelImage): Promise<ChannelImage>;
}
export declare class GaussianBlurWebGL extends BaseWebGLStrategy implements Preprocessor {
    private readonly sigma;
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    constructor(sigma?: number);
    process(input: ChannelImage): Promise<ChannelImage>;
}
export declare class MedianFilterWebGL extends BaseWebGLStrategy implements Preprocessor {
    private readonly config;
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    constructor(config?: Partial<MedianFilterConfig>);
    process(input: ChannelImage): Promise<ChannelImage>;
}
export declare class KuwaharaFilterWebGL extends BaseWebGLStrategy implements Preprocessor {
    private readonly config;
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    constructor(config?: Partial<KuwaharaFilterConfig>);
    process(input: ChannelImage): Promise<ChannelImage>;
}
export declare class ContrastEnhancerWebGL extends BaseWebGLStrategy implements Preprocessor {
    private readonly blackPoint;
    private readonly whitePoint;
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    constructor(blackPoint?: number, whitePoint?: number);
    process(input: ChannelImage): Promise<ChannelImage>;
}
export declare class QuantizerWebGL extends BaseWebGLStrategy implements Preprocessor {
    private readonly levels;
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    constructor(levels?: number);
    process(input: ChannelImage): Promise<ChannelImage>;
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