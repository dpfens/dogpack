/**
 * Strategy pattern for parameter maps. plain classes matching how
 * every Preprocessor/BlurStrategy elsewhere in this codebase is written.
 * `param` is the swap contract: ParameterMapPipeline.set() and
 * CompositeStrategy both check it before wiring a strategy in.
 */

import type { ChannelImage, Preprocessor, Disposable } from '../interfaces/base.js';
import { GaussianBlur } from '../preprocess/preprocessors/preprocessor.js';
import { LocalVariancePreprocessor, type LocalVarianceConfig } from '../preprocess/preprocessors/cpu.js';
import { computeStructureTensorMaps, type StructureTensorMaps } from './structure-tensor.js';
import { lerpChannel, mapChannel, blendChannels, multiplyChannels, combineChannels, normalizeChannel } from './channel-map-ops.js';

export type DogMapParam = 'p' | 'epsilon' | 'phi';

export interface ParameterMapStrategy extends Disposable {
  readonly param: DogMapParam;
  compute(input: ChannelImage): Promise<ChannelImage>;
}


/** Local-variance texture. High texture -> low p / high epsilon. */
export class TextureStrategy implements ParameterMapStrategy {
  constructor(
    readonly param: 'p' | 'epsilon',
    private readonly opts: { low: number; high: number },
    private readonly config: Partial<LocalVarianceConfig> = {}
  ) {}

  async compute(input: ChannelImage): Promise<ChannelImage> {
    const texture = await new LocalVariancePreprocessor(this.config).process(input);
    return this.param === 'p'
      ? lerpChannel(this.opts.high, this.opts.low, texture)
      : lerpChannel(this.opts.low, this.opts.high, texture);
  }

  dispose(): void {}
}

/** Tone map (broad blur). Dark -> low epsilon (denser shading), light -> high epsilon. */
export class LuminanceStrategy implements ParameterMapStrategy {
  readonly param = 'epsilon' as const;
  private blurPromise?: Promise<GaussianBlur>;

  constructor(private readonly opts: { epsilonDark: number; epsilonLight: number; blurSigma?: number }) {}

  async compute(input: ChannelImage): Promise<ChannelImage> {
    this.blurPromise ??= GaussianBlur.create(this.opts.blurSigma ?? 8);
    const luminance = await (await this.blurPromise).process(input);
    return lerpChannel(this.opts.epsilonDark, this.opts.epsilonLight, luminance);
  }

  dispose(): void {
    this.blurPromise?.then((blur) => blur.dispose()).catch(() => {});
  }
}

/** |input - filter(input)| for any injected edge-preserving filter (Bilateral, Kuwahara, ...). */
export class DetailResidualStrategy implements ParameterMapStrategy {
  constructor(
    readonly param: 'p' | 'epsilon',
    private readonly filter: Preprocessor,
    private readonly opts: { low: number; high: number }
  ) {}

  async compute(input: ChannelImage): Promise<ChannelImage> {
    const smoothed = await this.filter.process(input);
    const residual = normalizeChannel(combineChannels([input, smoothed], ([a, b]) => Math.abs(a - b)));
    return this.param === 'p'
      ? lerpChannel(this.opts.high, this.opts.low, residual)
      : lerpChannel(this.opts.low, this.opts.high, residual);
  }

  dispose(): void {
    this.filter.dispose();
  }
}

/** Structure-tensor magnitude. High confidence -> low epsilon (let it through easily). */
export class StructureTensorMagnitudeStrategy implements ParameterMapStrategy {
  readonly param = 'epsilon' as const;

  constructor(
    private readonly cache: StructureTensorCache,
    private readonly opts: { epsilonLow: number; epsilonHigh: number; saturateAt: number }
  ) {}

  async compute(input: ChannelImage): Promise<ChannelImage> {
    const { magnitude } = this.cache.get(input);
    const normalized = mapChannel(magnitude, (v) => Math.min(1, v / this.opts.saturateAt));
    return lerpChannel(this.opts.epsilonHigh, this.opts.epsilonLow, normalized);
  }

  dispose(): void {}
}

/** Structure-tensor anisotropy. Coherent line -> high phi (crisp binary). */
export class StructureTensorAnisotropyStrategy implements ParameterMapStrategy {
  readonly param = 'phi' as const;

  constructor(
    private readonly cache: StructureTensorCache,
    private readonly opts: { phiLow: number; phiHigh: number }
  ) {}

  async compute(input: ChannelImage): Promise<ChannelImage> {
    const { anisotropy } = this.cache.get(input);
    return lerpChannel(this.opts.phiLow, this.opts.phiHigh, anisotropy);
  }

  dispose(): void {}
}

/**
 * Shared per-input tensor cache, keyed by ChannelImage reference. Magnitude
 * and anisotropy strategies both read from the same e/f/g, so wiring them
 * to one cache (via structureTensorStrategies() below) avoids computing
 * the tensor twice per frame.
 */
class StructureTensorCache {
  private readonly cache = new WeakMap<ChannelImage, StructureTensorMaps>();
  constructor(private readonly smoothingRadius: number) {}

  get(input: ChannelImage): StructureTensorMaps {
    let maps = this.cache.get(input);
    if (!maps) this.cache.set(input, (maps = computeStructureTensorMaps(input, this.smoothingRadius)));
    return maps;
  }
}

/** Builds the magnitude/anisotropy pair sharing one StructureTensorCache. */
export function structureTensorStrategies(opts: {
  smoothingRadius?: number;
  epsilon: { epsilonLow: number; epsilonHigh: number; saturateAt: number };
  phi: { phiLow: number; phiHigh: number };
}): { magnitude: StructureTensorMagnitudeStrategy; anisotropy: StructureTensorAnisotropyStrategy } {
  const cache = new StructureTensorCache(opts.smoothingRadius ?? 2);
  return {
    magnitude: new StructureTensorMagnitudeStrategy(cache, opts.epsilon),
    anisotropy: new StructureTensorAnisotropyStrategy(cache, opts.phi),
  };
}

// ---- Combinators ---------------------------------------------------------

/** Combines strategies driving the same param. `mode: 'blend'` averages
 *  independent votes; `'requireAll'` multiplies, so each acts as a veto. */
export class CompositeStrategy implements ParameterMapStrategy {
  constructor(
    readonly param: DogMapParam,
    private readonly entries: Array<{ strategy: ParameterMapStrategy; weight?: number }>,
    private readonly mode: 'blend' | 'requireAll' = 'blend'
  ) {
    for (const e of entries) {
      if (e.strategy.param !== param) {
        throw new Error(`CompositeStrategy(${param}): got a strategy tagged '${e.strategy.param}'`);
      }
    }
  }

  async compute(input: ChannelImage): Promise<ChannelImage> {
    const maps = await Promise.all(this.entries.map((e) => e.strategy.compute(input)));
    return this.mode === 'blend'
      ? blendChannels(maps.map((map, i) => ({ map, weight: this.entries[i].weight ?? 1 })))
      : multiplyChannels(maps);
  }

  dispose(): void {
    this.entries.forEach((e) => e.strategy.dispose());
  }
}

/** Registers a strategy per param; `build()` produces DoGConfig-ready overrides. */
export class ParameterMapPipeline implements Disposable {
  constructor(private readonly strategies: Partial<Record<DogMapParam, ParameterMapStrategy>>) {}

  async build(input: ChannelImage): Promise<Partial<Record<DogMapParam, ChannelImage>>> {
    const entries = Object.entries(this.strategies) as [DogMapParam, ParameterMapStrategy][];
    const results = await Promise.all(entries.map(([, s]) => s.compute(input)));
    const overrides: Partial<Record<DogMapParam, ChannelImage>> = {};
    entries.forEach(([param], i) => {
      overrides[param] = results[i];
    });
    return overrides;
  }

  /** Swap the strategy registered for a param, disposing the old one. */
  set(param: DogMapParam, strategy: ParameterMapStrategy): void {
    if (strategy.param !== param) {
      throw new Error(`ParameterMapPipeline.set('${param}'): strategy is tagged '${strategy.param}'`);
    }
    this.strategies[param]?.dispose();
    this.strategies[param] = strategy;
  }

  dispose(): void {
    Object.values(this.strategies).forEach((s) => s?.dispose());
  }
}
