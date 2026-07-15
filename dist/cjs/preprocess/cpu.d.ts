/**
 * Preprocessing module for XDoG/FDoG
 *
 * Provides filters to prepare images before line detection.
 * These help reduce noise and texture while preserving important edges.
 *
 * Section 3.2 of the paper discusses the importance of bilateral
 * preprocessing for "indication" - attenuating weak edges while
 * preserving strong edges.
 */
import type { ChannelImage, BilateralFilterConfig, MedianFilterConfig, KuwaharaFilterConfig, Preprocessor } from '../interfaces/base.js';
import { BaseCPUStrategy } from '../base.js';
/**
 * Bilateral Filter
 *
 * Edge-preserving smoothing filter that averages pixels based on both
 * spatial proximity AND intensity similarity. This smooths out texture
 * (like grass) while keeping strong edges (like the car outline) sharp.
 *
 * This is the recommended preprocessing for most images.
 *
 * As mentioned in Section 3.2, bilateral filtering can serve as a
 * "prioritization mechanism" for indication - attenuating weak edges
 * while supporting strong edges.
 *
 * CPU is always available (BaseCPUStrategy.isSupported() / dispose() /
 * backend all apply unchanged) — this is the universal fallback.
 */
export declare class BilateralFilter extends BaseCPUStrategy implements Preprocessor {
    private readonly config;
    constructor(config?: Partial<BilateralFilterConfig>);
    process(input: ChannelImage): Promise<ChannelImage>;
}
/**
 * Median Filter
 *
 * Replaces each pixel with the median of its neighborhood.
 * Excellent for removing salt-and-pepper noise and small texture details.
 */
export declare class MedianFilter extends BaseCPUStrategy implements Preprocessor {
    private readonly config;
    constructor(config?: Partial<MedianFilterConfig>);
    process(input: ChannelImage): Promise<ChannelImage>;
}
/**
 * Kuwahara Filter
 *
 * Artistic smoothing filter that creates a painterly effect.
 * Divides the neighborhood into 4 quadrants, finds the one with
 * lowest variance, and uses its mean. Creates flat regions with
 * preserved edges - great for a more stylized look.
 */
export declare class KuwaharaFilter extends BaseCPUStrategy implements Preprocessor {
    private readonly config;
    constructor(config?: Partial<KuwaharaFilterConfig>);
    process(input: ChannelImage): Promise<ChannelImage>;
}
/**
 * Gaussian Blur
 *
 * Simple Gaussian smoothing. Less edge-preserving than bilateral,
 * but faster. Good for very noisy images or when used with small sigma.
 */
export declare class GaussianBlur extends BaseCPUStrategy implements Preprocessor {
    private readonly sigma;
    constructor(sigma?: number);
    process(input: ChannelImage): Promise<ChannelImage>;
}
/**
 * Contrast Enhancement
 *
 * Stretches the histogram to use the full 0-1 range.
 * Can help make edges more distinct before processing.
 */
export declare class ContrastEnhancer extends BaseCPUStrategy implements Preprocessor {
    private readonly blackPoint;
    private readonly whitePoint;
    constructor(blackPoint?: number, whitePoint?: number);
    process(input: ChannelImage): Promise<ChannelImage>;
}
/**
 * Quantize to reduce color levels
 *
 * Reduces the number of intensity levels, creating a posterized effect.
 * Can help reduce noise by grouping similar intensities together.
 */
export declare class Quantizer extends BaseCPUStrategy implements Preprocessor {
    private readonly levels;
    constructor(levels?: number);
    process(input: ChannelImage): Promise<ChannelImage>;
}
/**
 * Preset preprocessing pipelines for common use cases
 */
export declare const PreprocessingPresets: {
    /**
     * Light preprocessing - minimal smoothing
     * Good for: Clean studio photos, illustrations
     */
    light: (input: ChannelImage) => Promise<ChannelImage>;
    /**
     * Standard preprocessing - balanced smoothing
     * Good for: Most outdoor photos, portraits
     */
    standard: (input: ChannelImage) => Promise<ChannelImage>;
    /**
     * Heavy preprocessing - aggressive noise removal
     * Good for: Very textured images (grass, foliage, fabric)
     */
    heavy: (input: ChannelImage) => Promise<ChannelImage>;
    /**
     * Artistic preprocessing - painterly smoothing
     * Good for: Stylized/artistic output
     */
    artistic: (input: ChannelImage) => Promise<ChannelImage>;
    /**
     * Photo preprocessing - for photos with grass/nature
     * Good for: Landscape, outdoor scenes
     */
    nature: (input: ChannelImage) => Promise<ChannelImage>;
};
/**
 * Convenience class for chaining preprocessing operations
 */
export declare class PreprocessingPipeline {
    private operations;
    /**
     * Add bilateral filter to the pipeline
     */
    bilateral(config?: Partial<BilateralFilterConfig>): this;
    /**
     * Add median filter to the pipeline
     */
    median(config?: Partial<MedianFilterConfig>): this;
    /**
     * Add Kuwahara filter to the pipeline
     */
    kuwahara(config?: Partial<KuwaharaFilterConfig>): this;
    /**
     * Add Gaussian blur to the pipeline
     */
    gaussian(sigma?: number): this;
    /**
     * Add contrast enhancement to the pipeline
     */
    contrast(blackPoint?: number, whitePoint?: number): this;
    /**
     * Add quantization to the pipeline
     */
    quantize(levels?: number): this;
    /**
     * Add an arbitrary custom preprocessing strategy to the pipeline
     */
    use(preprocessor: Preprocessor): this;
    /**
     * Apply all operations in sequence
     */
    apply(input: ChannelImage): Promise<ChannelImage>;
    /**
     * Clear all operations
     */
    clear(): this;
}
//# sourceMappingURL=cpu.d.ts.map