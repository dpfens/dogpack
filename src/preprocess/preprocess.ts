/**
 * Composed Preprocessing Module for XDoG/FDoG
 *
 * This module is the single entry point the rest of the codebase should
 * import from. Each exported class picks its backend ONCE, at
 * construction time:
 *
 *   - WebGL 2.0 available  -> delegates to the GPU implementation (webgl.ts)
 *   - WebGL 2.0 unavailable -> delegates to the CPU implementation (cpu.ts)
 */

import type {
  ChannelImage,
  BilateralFilterConfig,
  MedianFilterConfig,
  KuwaharaFilterConfig,
  Preprocessor,
} from '../types.js';

import {
  BilateralFilterWebGL,
  MedianFilterWebGL,
  KuwaharaFilterWebGL,
  GaussianBlurWebGL,
  ContrastEnhancerWebGL,
  QuantizerWebGL,
  isWebGLAvailable,
  disposeWebGL,
} from './webgl.js';

import {
  BilateralFilter as BilateralFilterCPU,
  MedianFilter as MedianFilterCPU,
  KuwaharaFilter as KuwaharaFilterCPU,
  GaussianBlur as GaussianBlurCPU,
  ContrastEnhancer as ContrastEnhancerCPU,
  Quantizer as QuantizerCPU,
} from './cpu.js';

// ============================================================================
// Backend selection
// ============================================================================

/**
 * Optional override for backend selection. Useful for tests (deterministic
 * CPU output, or running in a Node environment with no WebGL at all) or for
 * explicitly forcing a backend regardless of what the environment supports.
 */
export interface BackendOptions {
  /** Force CPU even if WebGL is available. Default: false. */
  forceCPU?: boolean;
}

function useWebGL(options?: BackendOptions): boolean {
  if (options?.forceCPU) return false;
  return isWebGLAvailable();
}

// ============================================================================
// Composed Filters
// ============================================================================

/**
 * Edge-preserving smoothing filter. Uses the GPU implementation when
 * available, otherwise falls back to the CPU implementation.
 */
export class BilateralFilter implements Preprocessor {
  private readonly instance: Preprocessor;

  constructor(config: Partial<BilateralFilterConfig> = {}, options?: BackendOptions) {
    this.instance = useWebGL(options)
      ? new BilateralFilterWebGL(config)
      : new BilateralFilterCPU(config);
  }

  process(input: ChannelImage): ChannelImage {
    return this.instance.process(input);
  }
}

/**
 * Median filter for salt-and-pepper noise removal.
 */
export class MedianFilter implements Preprocessor {
  private readonly instance: Preprocessor;

  constructor(config: Partial<MedianFilterConfig> = {}, options?: BackendOptions) {
    this.instance = useWebGL(options)
      ? new MedianFilterWebGL(config)
      : new MedianFilterCPU(config);
  }

  process(input: ChannelImage): ChannelImage {
    return this.instance.process(input);
  }
}

/**
 * Kuwahara filter for a painterly, stylized effect.
 */
export class KuwaharaFilter implements Preprocessor {
  private readonly instance: Preprocessor;

  constructor(config: Partial<KuwaharaFilterConfig> = {}, options?: BackendOptions) {
    this.instance = useWebGL(options)
      ? new KuwaharaFilterWebGL(config)
      : new KuwaharaFilterCPU(config);
  }

  process(input: ChannelImage): ChannelImage {
    return this.instance.process(input);
  }
}

/**
 * Separable Gaussian blur.
 */
export class GaussianBlur implements Preprocessor {
  private readonly instance: Preprocessor;

  constructor(sigma: number = 1.0, options?: BackendOptions) {
    this.instance = useWebGL(options)
      ? new GaussianBlurWebGL(sigma)
      : new GaussianBlurCPU(sigma);
  }

  process(input: ChannelImage): ChannelImage {
    return this.instance.process(input);
  }
}

/**
 * Histogram-percentile contrast stretch.
 */
export class ContrastEnhancer implements Preprocessor {
  private readonly instance: Preprocessor;

  constructor(blackPoint: number = 0.01, whitePoint: number = 0.99, options?: BackendOptions) {
    this.instance = useWebGL(options)
      ? new ContrastEnhancerWebGL(blackPoint, whitePoint)
      : new ContrastEnhancerCPU(blackPoint, whitePoint);
  }

  process(input: ChannelImage): ChannelImage {
    return this.instance.process(input);
  }
}

/**
 * Posterize/quantize intensity levels.
 */
export class Quantizer implements Preprocessor {
  private readonly instance: Preprocessor;

  constructor(levels: number = 8, options?: BackendOptions) {
    this.instance = useWebGL(options)
      ? new QuantizerWebGL(levels)
      : new QuantizerCPU(levels);
  }

  process(input: ChannelImage): ChannelImage {
    return this.instance.process(input);
  }
}

// ============================================================================
// Presets
// ============================================================================
// Built on top of the composed filters above, so each preset automatically
// gets the GPU-when-available/CPU-otherwise behavior for free, with no
// duplicated branching logic.

export const PreprocessingPresets = {
  /**
   * Light preprocessing - minimal smoothing
   * Good for: Clean studio photos, illustrations
   */
  light: (input: ChannelImage): ChannelImage => {
    return new BilateralFilter({ sigmaSpatial: 2, sigmaRange: 0.08 }).process(input);
  },

  /**
   * Standard preprocessing - balanced smoothing
   * Good for: Most outdoor photos, portraits
   */
  standard: (input: ChannelImage): ChannelImage => {
    return new BilateralFilter({ sigmaSpatial: 4, sigmaRange: 0.1 }).process(input);
  },

  /**
   * Heavy preprocessing - aggressive noise removal
   * Good for: Very textured images (grass, foliage, fabric)
   */
  heavy: (input: ChannelImage): ChannelImage => {
    let result = new BilateralFilter({ sigmaSpatial: 5, sigmaRange: 0.12 }).process(input);
    result = new BilateralFilter({ sigmaSpatial: 3, sigmaRange: 0.1 }).process(result);
    return result;
  },

  /**
   * Artistic preprocessing - painterly smoothing
   * Good for: Stylized/artistic output
   */
  artistic: (input: ChannelImage): ChannelImage => {
    let result = new KuwaharaFilter({ radius: 4 }).process(input);
    result = new BilateralFilter({ sigmaSpatial: 2, sigmaRange: 0.08 }).process(result);
    return result;
  },

  /**
   * Photo preprocessing - for photos with grass/nature
   * Good for: Landscape, outdoor scenes
   */
  nature: (input: ChannelImage): ChannelImage => {
    let result = new BilateralFilter({ sigmaSpatial: 6, sigmaRange: 0.15 }).process(input);
    result = new BilateralFilter({ sigmaSpatial: 3, sigmaRange: 0.08 }).process(result);
    return result;
  },
};

// ============================================================================
// Pipeline (Fluent API)
// ============================================================================

/**
 * Convenience class for chaining preprocessing operations. Each stage picks
 * its backend (GPU vs CPU) independently at the time it's added, using
 * whatever `isWebGLAvailable()` reports at that moment.
 */
export class PreprocessingPipeline {
  private operations: Preprocessor[] = [];

  constructor(private readonly options?: BackendOptions) {}

  bilateral(config?: Partial<BilateralFilterConfig>): this {
    this.operations.push(new BilateralFilter(config, this.options));
    return this;
  }

  median(config?: Partial<MedianFilterConfig>): this {
    this.operations.push(new MedianFilter(config, this.options));
    return this;
  }

  kuwahara(config?: Partial<KuwaharaFilterConfig>): this {
    this.operations.push(new KuwaharaFilter(config, this.options));
    return this;
  }

  gaussian(sigma?: number): this {
    this.operations.push(new GaussianBlur(sigma, this.options));
    return this;
  }

  contrast(blackPoint?: number, whitePoint?: number): this {
    this.operations.push(new ContrastEnhancer(blackPoint, whitePoint, this.options));
    return this;
  }

  quantize(levels?: number): this {
    this.operations.push(new Quantizer(levels, this.options));
    return this;
  }

  /**
   * Add an arbitrary custom preprocessing strategy to the pipeline.
   * Bring your own backend selection if needed.
   */
  use(preprocessor: Preprocessor): this {
    this.operations.push(preprocessor);
    return this;
  }

  apply(input: ChannelImage): ChannelImage {
    let result = input;
    for (const op of this.operations) {
      result = op.process(result);
    }
    return result;
  }

  clear(): this {
    this.operations = [];
    return this;
  }
}

// ============================================================================
// Re-exports
// ============================================================================

export { isWebGLAvailable, disposeWebGL };