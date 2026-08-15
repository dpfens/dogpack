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
 * in `ResilientEdgeAwareFilter`, not duplicated per filter.
 */

import type {
  ChannelImage,
  BilateralFilterConfig,
  MedianFilterConfig,
  KuwaharaFilterConfig,
  EdgeAwareFilterCtor,
  EdgeAwareFilterCore,
  ContrastEnhancementConfig,
  GaussianConfig,
  QuantizerConfig,
  IsotropicBlurConfig,
} from '../interfaces/base.js';
import { ResilientEdgeAwareFilter } from './resilient-filter.js';
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
import { WebGPUIsotropicFilter } from './isotropic/webgpu.js';
import { WebGLIsotropicFilter } from './isotropic/webgl.js';
import { CPUIsotropicFilter } from './isotropic/cpu.js';


export interface BackendOptions {
  /** Force CPU even if WebGL/WebGPU are available. Default: false. */
  forceCPU?: boolean;
}

function pickCandidates<TConfig>(
  candidates: readonly EdgeAwareFilterCtor<TConfig>[],
  options?: BackendOptions
): readonly EdgeAwareFilterCtor<TConfig>[] {
  if (!options?.forceCPU) return candidates;
  return [candidates[candidates.length - 1]];
}


/**
 * Edge-preserving smoothing filter. Resolves the best supported backend
 * at creation time; falls back once if that backend fails later.
 */
export class BilateralFilter extends ResilientEdgeAwareFilter<Partial<BilateralFilterConfig>> {
  // Ordered best-to-worst. `satisfies` (not `implements`) catches a
  // backend missing isSupported() or the instance shape at this line.
  private static readonly candidates = [
    GPUBilateralFilter,
    BilateralFilterWebGL,
    BilateralFilterCPU,
  ] satisfies EdgeAwareFilterCtor<BilateralFilterConfig>[];

  private constructor(
    resolved: { instance: EdgeAwareFilterCore<BilateralFilterConfig>; ctor: EdgeAwareFilterCtor<BilateralFilterConfig> },
    config: Partial<BilateralFilterConfig>
  ) {
    super(BilateralFilter.candidates, resolved, config);
  }

  static async create(
    config: Partial<BilateralFilterConfig> = {},
    options?: BackendOptions
  ): Promise<BilateralFilter> {
    const resolved = await ResilientEdgeAwareFilter.resolve(
      pickCandidates(BilateralFilter.candidates, options),
      config
    );
    return new BilateralFilter(resolved, config);
  }
}

/**
 * Median filter for salt-and-pepper noise removal.
 */
export class MedianFilter extends ResilientEdgeAwareFilter<Partial<MedianFilterConfig>> {
  private static readonly candidates = [
    GPUMedianFilter,
    MedianFilterWebGL,
    MedianFilterCPU,
  ] satisfies EdgeAwareFilterCtor<MedianFilterConfig>[];

  private constructor(
    resolved: { instance: EdgeAwareFilterCore<MedianFilterConfig>; ctor: EdgeAwareFilterCtor<MedianFilterConfig> },
    config: Partial<MedianFilterConfig>
  ) {
    super(MedianFilter.candidates, resolved, config);
  }

  static async create(
    config: Partial<MedianFilterConfig> = {},
    options?: BackendOptions
  ): Promise<MedianFilter> {
    const resolved = await ResilientEdgeAwareFilter.resolve(
      pickCandidates(MedianFilter.candidates, options),
      config
    );
    return new MedianFilter(resolved, config);
  }
}

/**
 * Kuwahara filter for a painterly, stylized effect.
 */
export class KuwaharaFilter extends ResilientEdgeAwareFilter<Partial<KuwaharaFilterConfig>> {
  private static readonly candidates = [
    GPUKuwaharaFilter,
    KuwaharaFilterWebGL,
    KuwaharaFilterCPU,
  ] satisfies EdgeAwareFilterCtor<KuwaharaFilterConfig>[];

  private constructor(
    resolved: { instance: EdgeAwareFilterCore<KuwaharaFilterConfig>; ctor: EdgeAwareFilterCtor<KuwaharaFilterConfig> },
    config: Partial<KuwaharaFilterConfig>
  ) {
    super(KuwaharaFilter.candidates, resolved, config);
  }

  static async create(
    config: Partial<KuwaharaFilterConfig> = {},
    options?: BackendOptions
  ): Promise<KuwaharaFilter> {
    const resolved = await ResilientEdgeAwareFilter.resolve(
      pickCandidates(KuwaharaFilter.candidates, options),
      config
    );
    return new KuwaharaFilter(resolved, config);
  }
}

/**
 * Separable Isotropic blur.
 */
export class IsotropicBlurFilter extends ResilientEdgeAwareFilter<IsotropicBlurConfig> {
  private static readonly candidates = [
    WebGPUIsotropicFilter,
    WebGLIsotropicFilter,
    CPUIsotropicFilter,
  ] satisfies EdgeAwareFilterCtor<IsotropicBlurConfig>[];

  private constructor(resolved: { instance: EdgeAwareFilterCore<IsotropicBlurConfig>; ctor: EdgeAwareFilterCtor<IsotropicBlurConfig>}, config: IsotropicBlurConfig ) {
    super(IsotropicBlurFilter.candidates, resolved, config);
  }

  static async create(config: IsotropicBlurConfig, options?: BackendOptions): Promise<IsotropicBlurFilter> {
    const resolved = await ResilientEdgeAwareFilter.resolve(
      pickCandidates(IsotropicBlurFilter.candidates, options),
      config
    );
    return new IsotropicBlurFilter(resolved, config);
  }
}

/**
 * Separable Gaussian blur.
 */
export class GaussianBlur extends ResilientEdgeAwareFilter<GaussianConfig> {
  private static readonly candidates = [
    GPUGaussianBlur,
    GaussianBlurWebGL,
    GaussianBlurCPU,
  ] satisfies EdgeAwareFilterCtor<GaussianConfig>[];

  private constructor(resolved: { instance: EdgeAwareFilterCore<GaussianConfig>; ctor: EdgeAwareFilterCtor<GaussianConfig>}, config: GaussianConfig ) {
    super(GaussianBlur.candidates, resolved, config);
  }

  static async create(config: GaussianConfig, options?: BackendOptions): Promise<GaussianBlur> {
    const resolved = await ResilientEdgeAwareFilter.resolve(
      pickCandidates(GaussianBlur.candidates, options),
      config
    );
    return new GaussianBlur(resolved, config);
  }
}


export class ContrastEnhancer extends ResilientEdgeAwareFilter<ContrastEnhancementConfig> {
  private static readonly candidates = [
    GPUContrastEnhancer,
    ContrastEnhancerWebGL,
    ContrastEnhancerCPU,
  ] satisfies EdgeAwareFilterCtor<ContrastEnhancementConfig>[];

  private constructor(
    resolved: { instance: EdgeAwareFilterCore<ContrastEnhancementConfig>; ctor: EdgeAwareFilterCtor<ContrastEnhancementConfig> },
    config: ContrastEnhancementConfig
  ) {
    super(ContrastEnhancer.candidates, resolved, config);
  }

  static async create(
    blackPoint: number = 0.01,
    whitePoint: number = 0.99,
    options?: BackendOptions
  ): Promise<ContrastEnhancer> {
    const config: ContrastEnhancementConfig = { blackPoint, whitePoint };
    const resolved = await ResilientEdgeAwareFilter.resolve(
      pickCandidates(ContrastEnhancer.candidates, options),
      config
    );
    return new ContrastEnhancer(resolved, config);
  }
}

/**
 * Posterize/quantize intensity levels.
 */
export class Quantizer extends ResilientEdgeAwareFilter<QuantizerConfig> {
  private static readonly candidates = [
    GPUQuantizer,
    QuantizerWebGL,
    QuantizerCPU,
  ] satisfies EdgeAwareFilterCtor<QuantizerConfig>[];

  private constructor(resolved: { instance: EdgeAwareFilterCore<QuantizerConfig>; ctor: EdgeAwareFilterCtor<QuantizerConfig> }, config: QuantizerConfig) {
    super(Quantizer.candidates, resolved, config);
  }

  static async create(config: QuantizerConfig, options?: BackendOptions): Promise<Quantizer> {
    const resolved = await ResilientEdgeAwareFilter.resolve(
      pickCandidates(Quantizer.candidates, options),
      config
    );
    return new Quantizer(resolved, config);
  }
}


export const PreprocessingPresets = {
  /**
   * Light preprocessing - minimal smoothing
   * Good for: Clean studio photos, illustrations
   */
  light: async (input: ChannelImage): Promise<ChannelImage> => {
    const filter = await BilateralFilter.create();
    try {
      return await filter.apply(input, { sigmaSpatial: 2, sigmaRange: 0.08 });
    } finally {
      filter.dispose();
    }
  },

  /**
   * Standard preprocessing - balanced smoothing
   * Good for: Most outdoor photos, portraits
   */
  standard: async (input: ChannelImage): Promise<ChannelImage> => {
    const filter = await BilateralFilter.create();
    try {
      return await filter.apply(input, { sigmaSpatial: 4, sigmaRange: 0.1 });
    } finally {
      filter.dispose();
    }
  },

  /**
   * Heavy preprocessing - aggressive noise removal
   * Good for: Very textured images (grass, foliage, fabric)
   */
  heavy: async (input: ChannelImage): Promise<ChannelImage> => {
    const first = await BilateralFilter.create();
    const second = await BilateralFilter.create();
    try {
      return await second.apply(await first.apply(input, { sigmaSpatial: 5, sigmaRange: 0.12 }), { sigmaSpatial: 3, sigmaRange: 0.1 });
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
    const kuwahara = await KuwaharaFilter.create();
    const bilateral = await BilateralFilter.create();
    try {
      return await bilateral.apply(await kuwahara.apply(input, { radius: 4 }), { sigmaSpatial: 2, sigmaRange: 0.08 });
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
    const first = await BilateralFilter.create();
    const second = await BilateralFilter.create();
    try {
      return await second.apply(await first.apply(input, { sigmaSpatial: 6, sigmaRange: 0.15 }), { sigmaSpatial: 3, sigmaRange: 0.08 });
    } finally {
      first.dispose();
      second.dispose();
    }
  },
};

export { isWebGLAvailable, disposeWebGL, disposeWebGPU };