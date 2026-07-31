import type { ADoGConfig, BlendFunction, ChannelImage, DoGConfig, DoGImplementation, FDoGConfig, GradientAlignedBlurConfig, HDoGConfig, XDoGConfig } from "dogpack";
import { multiScale } from "dogpack/extensions";

export type BlurStrategyDescriptor =
  | { readonly kind: "isotropic"; kernelSizeMultiplier?: number }
  | { readonly kind: "gradient-aligned"; config?: Partial<GradientAlignedBlurConfig> }
  | { readonly kind: "flow-guided" };

/**
 * threshold.ts wasn't in front of me, so the 'hysteresis' fields below are a
 * guess -- line up with whatever constructor HysteresisThresholdStrategy
 * ends up with when you add it alongside Soft/HardThresholdStrategy.
 */
export type ThresholdStrategyDescriptor =
  | { readonly kind: "soft" }
  | { readonly kind: "hard" }
  | { readonly kind: "hysteresis"; highOffset?: number; lowOffset?: number };

/** Replace the keys present in `Overrides` on `T`; leave everything else untouched. */
type WithWireOverrides<T, Overrides> = Omit<T, keyof Overrides> & Overrides;

export interface AutoP {
  readonly mode: 'auto';
  weak: number;
  strong: number;
  smoothingSigma: number;
}
export interface AutoEpsilon {
  readonly mode: 'auto';
  sigma: number;
  contrastMargin: number;
}
export interface AutoPhi {
  readonly mode: 'auto';
  soft: number;
  hard: number;
  sigma: number;
}


type AutoDoGOverrides = {
  thresholdStrategy: ThresholdStrategyDescriptor;
  p: number | AutoP;
  epsilon: number | AutoEpsilon;
  phi: number | AutoPhi;
};


/**
 * Wire-safe version of the base DoGConfig that DogComponent emits. Every
 * XDoG/ADoG config ultimately spreads this in, so thresholdStrategy needs
 * fixing up here once, rather than at each derived Wire*Config.
 */
export type WireDoGConfig = WithWireOverrides<DoGConfig, AutoDoGOverrides>;

export type WireXDoGConfig = WithWireOverrides<
  XDoGConfig,
  AutoDoGOverrides & { blurStrategy?: BlurStrategyDescriptor }
>;
export type WireADoGConfig = WithWireOverrides<ADoGConfig, AutoDoGOverrides>;
// (unchanged reasoning from before: FDoG's DoGProcessor also needs a live
// thresholdStrategy/p/epsilon/phi, only blurStrategy is FDoG-internal)
export type WireFDoGConfig = WithWireOverrides<FDoGConfig, AutoDoGOverrides>;

export type WireHDoGConfig = WithWireOverrides<
  HDoGConfig,
  {
    fdog?: Partial<WireFDoGConfig>;
    adog?: Partial<WireADoGConfig>;
    adogSecondary?: Partial<WireADoGConfig>;
  }
>;

export type DogComponentType = "xdog" | "fdog" | "adog" | "hdog";
export type DogNodeKind = DogComponentType | 'layer' | 'preprocessing';

export interface DogConfig<T> {
  readonly kind: 'config';
  readonly type: DogComponentType;
  config: T;
}

export interface DogConfig<T> {
  readonly kind: 'config';
  readonly type: DogComponentType;
  config: T;
}

export interface XDogConfig extends DogConfig<WireXDoGConfig> { readonly type: "xdog"; }
export interface FDogConfig extends DogConfig<WireFDoGConfig> { readonly type: "fdog"; }
export interface ADogConfig extends DogConfig<WireADoGConfig> { readonly type: "adog"; }
export interface HDogConfig extends DogConfig<WireHDoGConfig> { readonly type: "hdog"; }

export type DogConfigNode = XDogConfig | FDogConfig | ADogConfig | HDogConfig;
export type DogNode = DogLayer | DogConfigNode;

/**
 * Shape for *presets* (STYLE_PRESETS / ADOG_STYLE_PRESETS / FDOG_STYLE_PRESETS /
 * HDOG_STYLE_PRESETS). Presets are plain numeric-parameter bags -- none of
 * them ever set blurStrategy/thresholdStrategy -- so rather than reconciling
 * "real instance" vs "wire descriptor" typing for a field nothing populates,
 * we drop those fields from the type entirely. Because they're just absent
 * (not present-with-wrong-type), this is structurally assignable both from
 * the library's real preset constants (which have the field as an unused
 * optional extra) and down into DogComponent's Partial<DoGConfig> preset
 * input (which has it as an optional field that's fine to omit).
 */
type PresetShape<T> = Partial<Omit<T, 'blurStrategy' | 'thresholdStrategy' | 'p' | 'epsilon' | 'phi'>> & {
  p?: number;
  epsilon?: number;
  phi?: number;
};
export type XDogPreset = PresetShape<WireXDoGConfig>;
export type ADogPreset = PresetShape<WireADoGConfig>;
export type FDogPreset = PresetShape<WireFDoGConfig>;
export interface HDogPresetConfig {
  fdog?: FDogPreset;
  adog?: ADogPreset;
  adogSecondaryScaleFactor?: number;
}

export interface HDogPresetConfig {
  fdog?: FDogPreset;
  adog?: ADogPreset;
  adogSecondaryScaleFactor?: number;
}

export interface DogLayer {
  readonly kind: 'layer';
  name: string;
  blendMode: multiScale.BuiltinBlendMode;
  components: DogNode[];
}

export type ThresholdType = 'Soft' | 'Hard' | 'Hysteresis';

export interface DogProcessingContext {
  dog: DogNode[];
}

export interface DogExecutionLeaf {
  readonly kind: "dog";
  /** Raw, unresolved config — construction is deferred to execute time,
   *  once the leaf's actual input image is known (see dog.ts service). */
  readonly implementation: DoGImplementation;
}

export type DogExecutionNode = DogExecutionLayer | DogExecutionLeaf;

export interface DogExecutionLayer {
  readonly kind: "layer";
  name: string;
  components: DogExecutionNode[];
  blendMode?: BlendFunction;
}

export interface DogExecutablePlan {
  dog: DogExecutionNode[];
}

export function isLayer(n: DogNode): n is DogLayer {
  return n.kind === 'layer';
}

export function isConfig(n: DogNode): n is DogConfigNode {
  return n.kind === 'config';
}

export function isConfigOfType<K extends DogComponentType>(
  n: DogNode,
  type: K,
): n is Extract<DogConfigNode, { type: K }> {
  return n.kind === 'config' && n.type === type;
}

export interface DogModelProvider<T extends DogNode> {
  toModel(): T;
}

/** What actually crosses the postMessage boundary to the worker - the config tree plus the pixels it runs on. */
export interface DogRunRequest {
  layer: DogLayer;
  image: ChannelImage; // from 'dogpack'
}