/**
 * Composed Preprocessing Module for XDoG/FDoG
 *
 * This module is the single entry point the rest of the codebase should
 * import from. Each exported class resolves its OWN best-supported
 * backend independently (WebGPU > WebGL > CPU), the first time it's
 * created:
 *
 *   BilateralFilter.create(...)  // may end up WebGPU on this device
 *   MedianFilter.create(...)     // may end up WebGL on this device, if
 *                                // e.g. it needs a storage texture format
 *                                // WebGPU can't provide here
 *
 * A device can support WebGPU for one algorithm and not another, so
 * resolution happens per class, not once globally for the whole module.
 * This follows the same pattern used for BlurStrategy/ETFComputer.
 *
 * If a backend fails mid-session (driver crash, lost context), each
 * instance demotes itself to the next supported candidate once and
 * retries the call that failed; that shared retry/demote machinery lives
 * in `ResilientPreprocessor`, not duplicated per filter.
 */

import type {
  ChannelImage,
  BilateralFilterConfig,
  MedianFilterConfig,
  KuwaharaFilterConfig,
  Preprocessor,
  PreprocessorCtor,
} from '../../interfaces/base.js';

import { ResilientPreprocessor } from './resilient-preprocessor.js';

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
  GPUBilateralFilter,
  GPUMedianFilter,
  GPUKuwaharaFilter,
  GPUGaussianBlur,
  GPUContrastEnhancer,
  GPUQuantizer,
  disposeWebGPU,
} from './webgpu.js';

import {
  BilateralFilter as BilateralFilterCPU,
  MedianFilter as MedianFilterCPU,
  KuwaharaFilter as KuwaharaFilterCPU,
  GaussianBlur as GaussianBlurCPU,
  ContrastEnhancer as ContrastEnhancerCPU,
  Quantizer as QuantizerCPU,
} from './cpu.js';


export interface BackendOptions {
  /** Force CPU even if WebGL/WebGPU are available. Default: false. */
  forceCPU?: boolean;
}

function pickCandidates(
  candidates: readonly PreprocessorCtor[],
  options?: BackendOptions
): readonly PreprocessorCtor[] {
  if (!options?.forceCPU) return candidates;
  return [candidates[candidates.length - 1]];
}


/**
 * Edge-preserving smoothing filter. Resolves the best supported backend
 * at creation time; falls back once if that backend fails later.
 */
export class BilateralFilter extends ResilientPreprocessor<Partial<BilateralFilterConfig>> {
  // Ordered best-to-worst. `satisfies` (not `implements`) catches a
  // backend missing isSupported() or the instance shape at this line.
  private static readonly candidates = [
    GPUBilateralFilter,
    BilateralFilterWebGL,
    BilateralFilterCPU,
  ] satisfies PreprocessorCtor[];

  private constructor(
    resolved: { instance: Preprocessor; ctor: PreprocessorCtor },
    config: Partial<BilateralFilterConfig>
  ) {
    super(BilateralFilter.candidates, resolved, config);
  }

  static async create(
    config: Partial<BilateralFilterConfig> = {},
    options?: BackendOptions
  ): Promise<BilateralFilter> {
    const resolved = await ResilientPreprocessor.resolve(
      pickCandidates(BilateralFilter.candidates, options),
      config
    );
    return new BilateralFilter(resolved, config);
  }
}

/**
 * Median filter for salt-and-pepper noise removal.
 */
export class MedianFilter extends ResilientPreprocessor<Partial<MedianFilterConfig>> {
  private static readonly candidates = [
    GPUMedianFilter,
    MedianFilterWebGL,
    MedianFilterCPU,
  ] satisfies PreprocessorCtor[];

  private constructor(
    resolved: { instance: Preprocessor; ctor: PreprocessorCtor },
    config: Partial<MedianFilterConfig>
  ) {
    super(MedianFilter.candidates, resolved, config);
  }

  static async create(
    config: Partial<MedianFilterConfig> = {},
    options?: BackendOptions
  ): Promise<MedianFilter> {
    const resolved = await ResilientPreprocessor.resolve(
      pickCandidates(MedianFilter.candidates, options),
      config
    );
    return new MedianFilter(resolved, config);
  }
}

/**
 * Kuwahara filter for a painterly, stylized effect.
 */
export class KuwaharaFilter extends ResilientPreprocessor<Partial<KuwaharaFilterConfig>> {
  private static readonly candidates = [
    GPUKuwaharaFilter,
    KuwaharaFilterWebGL,
    KuwaharaFilterCPU,
  ] satisfies PreprocessorCtor[];

  private constructor(
    resolved: { instance: Preprocessor; ctor: PreprocessorCtor },
    config: Partial<KuwaharaFilterConfig>
  ) {
    super(KuwaharaFilter.candidates, resolved, config);
  }

  static async create(
    config: Partial<KuwaharaFilterConfig> = {},
    options?: BackendOptions
  ): Promise<KuwaharaFilter> {
    const resolved = await ResilientPreprocessor.resolve(
      pickCandidates(KuwaharaFilter.candidates, options),
      config
    );
    return new KuwaharaFilter(resolved, config);
  }
}

/**
 * Separable Gaussian blur.
 */
export class GaussianBlur extends ResilientPreprocessor<number> {
  private static readonly candidates = [
    GPUGaussianBlur,
    GaussianBlurWebGL,
    GaussianBlurCPU,
  ] satisfies PreprocessorCtor[];

  private constructor(resolved: { instance: Preprocessor; ctor: PreprocessorCtor }, sigma: number) {
    super(GaussianBlur.candidates, resolved, sigma);
  }

  static async create(sigma: number = 1.0, options?: BackendOptions): Promise<GaussianBlur> {
    const resolved = await ResilientPreprocessor.resolve(
      pickCandidates(GaussianBlur.candidates, options),
      sigma
    );
    return new GaussianBlur(resolved, sigma);
  }
}


interface ContrastPoints {
  blackPoint: number;
  whitePoint: number;
}

function adaptContrastCtor(Ctor: new (b: number, w: number) => Preprocessor): PreprocessorCtor {
  const Adapted = class {
    static isSupported = (Ctor as unknown as PreprocessorCtor).isSupported;
    static getUnsupportedReason = (Ctor as unknown as PreprocessorCtor).getUnsupportedReason;
    constructor(config: ContrastPoints) {
      return new Ctor(config.blackPoint, config.whitePoint);
    }
  };
  return Adapted as unknown as PreprocessorCtor;
}

export class ContrastEnhancer extends ResilientPreprocessor<ContrastPoints> {
  private static readonly candidates = [
    adaptContrastCtor(GPUContrastEnhancer),
    adaptContrastCtor(ContrastEnhancerWebGL),
    adaptContrastCtor(ContrastEnhancerCPU),
  ] satisfies PreprocessorCtor[];

  private constructor(
    resolved: { instance: Preprocessor; ctor: PreprocessorCtor },
    config: ContrastPoints
  ) {
    super(ContrastEnhancer.candidates, resolved, config);
  }

  static async create(
    blackPoint: number = 0.01,
    whitePoint: number = 0.99,
    options?: BackendOptions
  ): Promise<ContrastEnhancer> {
    const config: ContrastPoints = { blackPoint, whitePoint };
    const resolved = await ResilientPreprocessor.resolve(
      pickCandidates(ContrastEnhancer.candidates, options),
      config
    );
    return new ContrastEnhancer(resolved, config);
  }
}

/**
 * Posterize/quantize intensity levels.
 */
export class Quantizer extends ResilientPreprocessor<number> {
  private static readonly candidates = [
    GPUQuantizer,
    QuantizerWebGL,
    QuantizerCPU,
  ] satisfies PreprocessorCtor[];

  private constructor(resolved: { instance: Preprocessor; ctor: PreprocessorCtor }, levels: number) {
    super(Quantizer.candidates, resolved, levels);
  }

  static async create(levels: number = 8, options?: BackendOptions): Promise<Quantizer> {
    const resolved = await ResilientPreprocessor.resolve(
      pickCandidates(Quantizer.candidates, options),
      levels
    );
    return new Quantizer(resolved, levels);
  }
}


export const PreprocessingPresets = {
  /**
   * Light preprocessing - minimal smoothing
   * Good for: Clean studio photos, illustrations
   */
  light: async (input: ChannelImage): Promise<ChannelImage> => {
    const filter = await BilateralFilter.create({ sigmaSpatial: 2, sigmaRange: 0.08 });
    try {
      return await filter.process(input);
    } finally {
      filter.dispose();
    }
  },

  /**
   * Standard preprocessing - balanced smoothing
   * Good for: Most outdoor photos, portraits
   */
  standard: async (input: ChannelImage): Promise<ChannelImage> => {
    const filter = await BilateralFilter.create({ sigmaSpatial: 4, sigmaRange: 0.1 });
    try {
      return await filter.process(input);
    } finally {
      filter.dispose();
    }
  },

  /**
   * Heavy preprocessing - aggressive noise removal
   * Good for: Very textured images (grass, foliage, fabric)
   */
  heavy: async (input: ChannelImage): Promise<ChannelImage> => {
    const first = await BilateralFilter.create({ sigmaSpatial: 5, sigmaRange: 0.12 });
    const second = await BilateralFilter.create({ sigmaSpatial: 3, sigmaRange: 0.1 });
    try {
      return await second.process(await first.process(input));
    } finally {
      first.dispose();
      second.dispose();
    }
  },

  /**
   * Artistic preprocessing - painterly smoothing
   * Good for: Stylized/artistic output
   */
  artistic: async (input: ChannelImage): Promise<ChannelImage> => {
    const kuwahara = await KuwaharaFilter.create({ radius: 4 });
    const bilateral = await BilateralFilter.create({ sigmaSpatial: 2, sigmaRange: 0.08 });
    try {
      return await bilateral.process(await kuwahara.process(input));
    } finally {
      kuwahara.dispose();
      bilateral.dispose();
    }
  },

  /**
   * Photo preprocessing - for photos with grass/nature
   * Good for: Landscape, outdoor scenes
   */
  nature: async (input: ChannelImage): Promise<ChannelImage> => {
    const first = await BilateralFilter.create({ sigmaSpatial: 6, sigmaRange: 0.15 });
    const second = await BilateralFilter.create({ sigmaSpatial: 3, sigmaRange: 0.08 });
    try {
      return await second.process(await first.process(input));
    } finally {
      first.dispose();
      second.dispose();
    }
  },
};

export class PreprocessingPipeline {
  private operations: Preprocessor[] = [];

  constructor(private readonly options?: BackendOptions) {}

  async bilateral(config?: Partial<BilateralFilterConfig>): Promise<this> {
    this.operations.push(await BilateralFilter.create(config, this.options));
    return this;
  }

  async median(config?: Partial<MedianFilterConfig>): Promise<this> {
    this.operations.push(await MedianFilter.create(config, this.options));
    return this;
  }

  async kuwahara(config?: Partial<KuwaharaFilterConfig>): Promise<this> {
    this.operations.push(await KuwaharaFilter.create(config, this.options));
    return this;
  }

  async gaussian(sigma?: number): Promise<this> {
    this.operations.push(await GaussianBlur.create(sigma, this.options));
    return this;
  }

  async contrast(blackPoint?: number, whitePoint?: number): Promise<this> {
    this.operations.push(await ContrastEnhancer.create(blackPoint, whitePoint, this.options));
    return this;
  }

  async quantize(levels?: number): Promise<this> {
    this.operations.push(await Quantizer.create(levels, this.options));
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

  async apply(input: ChannelImage): Promise<ChannelImage> {
    let result = input;
    for (const op of this.operations) {
      result = await op.process(result);
      op.dispose();
    }
    return result;
  }

  /** Disposes every staged operation's resources and clears the pipeline. */
  clear(): this {
    for (const op of this.operations) op.dispose();
    this.operations = [];
    return this;
  }
}

export { isWebGLAvailable, disposeWebGL, disposeWebGPU };