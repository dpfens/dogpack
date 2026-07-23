import { HardThresholdStrategy, SoftThresholdStrategy, type ThresholdStrategy } from '../threshold.js';
import type { BlurStrategy, ChannelImage } from './base.js';

/**
 * Configuration for Difference of Gaussians processing
 * 
 * Uses the reparameterized formulation from Section 2.5 of the paper:
 * S_σ,k,p(x) = G_σ(x) + p · D_σ,k(x) = (1 + p) · G_σ(x) - p · G_kσ(x)
 * 
 * This decouples edge sharpening strength (p) from threshold parameters,
 * making the filter much easier to control.
 */
export interface DoGConfig {
  /** 
   * Base blur sigma for edge detection (default: 1.0)
   * Controls the scale of detected edges - larger values detect coarser edges
   * Paper typically uses 0.4-2.0 for most styles
   */
  sigma: number;
  
  /** 
   * Ratio between the two Gaussian blur sizes (default: 1.6)
   * Paper recommends k = 1.6 as a good engineering trade-off
   * This approximates the Laplacian of Gaussian
   */
  k: number;
  
  /** 
   * Sharpening strength parameter 'p' from Equation 7 (default: 20)
   * Controls the strength of edge emphasis
   * - p ≈ 0: No edge enhancement, just blurred image
   * - p ≈ 20: Strong edges suitable for thresholding (paper's typical value)
   * - p ≈ 100+: Extreme edge emphasis for woodcut style
   * 
   * Note: This replaces the original τ parameter. The relationship is:
   * p = τ / (τ - 1), or equivalently τ = p / (p + 1)
   */
  p: number | ChannelImage; 
  
  /** 
   * Threshold for white vs black transition (default: 0.5)
   * Values above this become white, values below follow the soft threshold
   * Should be in 0-1 range for normalized images
   * Paper's Appendix A shows values around 0.72-0.88 (normalized from 0-100)
   */
  epsilon: number | ChannelImage;
  
  /** 
   * Sharpness of the soft threshold / tanh steepness (default: 10)
   * Controls the transition sharpness between black and white
   * - φ ≈ 0.01: Very soft transitions (pencil shading, pastel)
   * - φ ≈ 1-10: Moderate transitions
   * - φ >> 10: Hard black/white threshold (approaches step function)
   */
  phi: number | ChannelImage;

  /**
   * Strategy used to convert the sharpened DoG response into the final output image
   * 
   * Decouples how thresholding is performed from the edge-detection/sharpening
   * pipeline (sigma, k, p).  Allows swapping strategies without touching the rest of the config.
   * Consumes `epsilon` and `phi` from this config as its ThresholdConfig.
   * 
   * Built-in strategies (see threshold.ts):
   * - `SoftThresholdStrategy`: tanh-based soft transition, governed by `phi`
   *   (steepness) and `epsilon` (midpoint). Produces the smooth pencil/pastel-to-hard-edge
   *   range described by `phi` above. This is the paper's standard XDoG threshold.
   * - `HardThresholdStrategy`: binary step function at `epsilon` (ignores `phi`).
   *   Equivalent to the φ → ∞ limit of the soft strategy; suited to styles like ADoG
   *   that expect a strictly binarized screentone output.
   * - `HysteresisThresholdStrategy`: Canny-style double threshold with flood-fill
   *   linking, using `epsilon ± highOffset/lowOffset` as the high/low bounds. Produces
   *   cleaner, more connected edge lines than a single global threshold, at the cost
   *   of ignoring `phi` and requiring a full-image connectivity pass.
   */
  thresholdStrategy: ThresholdStrategy;
}

/**
 * XDoG configuration combining DoG parameters with isotropic blur options
 */
export interface XDoGConfig extends DoGConfig {
  /** Kernel size multiplier for Gaussian blur (default: 6) */
  kernelSizeMultiplier?: number;
  blurStrategy?: BlurStrategy;
}


/**
 * Extended configuration for Flow-based DoG (FDoG)
 * 
 * FDoG uses three separate sigma parameters as described in Section 2.6:
 */
export interface FDoGConfig extends DoGConfig {
  /**
   * σc: Structure tensor smoothing sigma (default: 2.5)
   * Controls the scale of the edge tangent flow computation
   * - Small values: More noise in flow field, captures fine edges
   * - Large values: Smoother flow, may distort fine features
   */
  sigmaC: number;
  
  /**
   * σe: Edge detection sigma - same as 'sigma' in base DoGConfig
   * Controls the width of gradient-aligned DoG filter
   * Larger values discard more fine details and result in wider edge lines
   */
  // Uses 'sigma' from DoGConfig
  
  /**
   * σm: Flow-aligned smoothing sigma for line integral convolution (default: 3.0)
   * Controls the coherence of edge lines
   * - Small values: Short, potentially disconnected edges
   * - Large values: Long, coherent edges (may introduce noise if >> σc)
   */
  sigmaM: number;
  
  /**
   * σa: Anti-aliasing LIC sigma (default: 1.0)
   * Applied as a post-processing step along the ETF
   * - 0: No anti-aliasing
   * - 0.5-2: Typical anti-aliasing
   * - >2: Stylistic smoothing effect
   */
  sigmaA: number;

  /**
   * Number of smoothing iterations applied when computing the Edge Tangent Flow (ETF)
   * 
   * The ETF is built iteratively by locally averaging tangent directions with 
   * neighboring pixels, progressively refining the flow field so it follows 
   * coherent edge structures rather than noisy per-pixel gradients (default: 3)
   * - 0-1: Flow field closely follows raw gradients; noisy, jagged edge directions
   * - 2-4: Typical range; smooth, stable flow suitable for line integral convolution
   * - 5+: Very smooth flow, but expensive and can over-round sharp corners/junctions
   * 
   * This directly affects the quality of edges produced during LIC-based smoothing 
   * (governed by sigmaM/sigmaA) an under-converged ETF will propagate noise into 
   * the final stylized lines regardless of how sigmaM/sigmaA are tuned.
   */
  etfIterations?: number
}

/**
 * Configuration for Adaptive Difference of Gaussians (ADoG)
 * 
 * Based on Section 3.2, Eqs. (3)-(6) of "Gaussian Image Binarization"
 * (Kang & Stamoulis, 2021). ADoG modifies the DoG contrast-sensitivity
 * parameter to be a function of local tone, producing a screentoning effect
 * whose primitive density is inversely proportional to brightness.
 * 
 * Note: 'sigma' (inherited from DoGConfig) plays the role of σc, and
 * 'k' plays the role of the σs/σc ratio (σs = k * σc), matching the
 * paper's defaults of σc = 1.0 and σs = 1.6σc.
 */
export interface ADoGConfig extends DoGConfig {
  /**
   * τ: minimum contrast sensitivity (default: 0.99)
   * ρ(x) ranges within [τ, 1]. Higher values produce noisier responses.
   * Paper restricts τ to [0.97, 1.0].
   */
  tau: number;

  /**
   * s: controls the steepness of tone-dependent falloff in ρ(x) (Eq. 5)
   * and in the adaptive noise scale σ(x) (Eq. 6) (default: 2.0)
   * Larger s concentrates the density transition into darker tones.
   */
  s: number;

  /**
   * Adaptive noise scale factor 'c' in Eq. (6) (default: 0.01)
   * Set to 0 to disable noise injection entirely (Eq. 6 is optional --
   * see Fig. 8 in the paper for the effect of enabling it).
   */
  noiseScaleC: number;

  /**
   * Kernel size multiplier for the isotropic Gaussian blur (default: 6)
   * Same meaning as XDoGConfig's kernelSizeMultiplier.
   */
  kernelSizeMultiplier?: number;
}

/**
 * Configuration for Hybrid Difference of Gaussians (HDoG)
 * 
 * Combines FDoG (line drawing) with two ADoG passes at different scales,
 * per Eq. (9): HDoG = FDoG ∧ ADoG_s ∧ ADoG_s'
 */
export interface HDoGConfig {
  /** Configuration passed to the internal FDoG instance */
  fdog: Partial<FDoGConfig>;

  /**
   * Configuration passed to the primary ADoG instance (uses its own 's').
   * The secondary ADoG pass reuses this config but overrides 's' with
   * s * adogSecondaryScaleFactor (Eq. 9).
   */
  adog: Partial<ADoGConfig>;

  /**
   * s' = adogSecondaryScaleFactor * s, per Eq. (9) (default: 4)
   * Generates additional screentone in the darkest regions without
   * affecting brighter ones (paper empirically sets s' = 4s).
   */
  adogSecondaryScaleFactor: number;

  /**
   * Optional partial override applied on top of the derived secondary
   * ADoG config (primary config + s' = adogSecondaryScaleFactor * s).
   * Use this to tweak individual fields (e.g. epsilon, phi) for the
   * secondary pass without re-specifying the whole config.
   */
  adogSecondary?: Partial<ADoGConfig>;
}

export interface DoGProcessingResult {
  /** Final thresholded output */
  result: ChannelImage;
  /** Sharpened image before thresholding */
  sharpened: ChannelImage;
  /** Raw DoG response (blur1 - blur2) */
  rawDoG?: ChannelImage;
}

/**
 * Result of HDoG processing.
 * 
 * Structurally compatible with DoGProcessingResult (result and sharpened
 * are present), so this satisfies DoGImplementation.processDetailed()'s
 * return type. `sharpened` is set to the FDoG pass's sharpened image as a
 * representative value -- HDoG has no single "sharpened" stage of its own,
 * since it combines three already-binarized outputs. Callers holding a
 * concrete HDoG get the full per-pass breakdown via fdogResult /
 * adogPrimaryResult / adogSecondaryResult.
 */
export interface HDoGProcessingResult extends DoGProcessingResult {
  fdogResult: ChannelImage;
  adogPrimaryResult: ChannelImage;
  adogSecondaryResult: ChannelImage;
}


/**
 * Result of ADoG processing, extending the standard DoGProcessingResult
 * with ADoG-specific intermediate artifacts.
 * 
 * This is structurally compatible with DoGProcessingResult (result,
 * sharpened, and rawDoG are all present with matching types), so it
 * satisfies DoGImplementation.processDetailed()'s return type. Callers
 * holding a concrete ADoG (rather than the generic DoGImplementation
 * interface) additionally get rhoMap and noisyInput; nothing is lost, it's
 * just not visible through the narrower interface type.
 * 
 * Field mapping vs. XDoG/FDoG's use of "sharpened"/"rawDoG":
 *   - rawDoG: the UNWEIGHTED response G_σc - G_σs (ρ ≡ 1), i.e. standard
 *     DoG -- this is what Fig. 7(b) in the paper compares against.
 *   - sharpened: the ρ(x)-WEIGHTED response (Eq. 4), pre-threshold. It's
 *     not an unsharp-mask "sharpened" image the way XDoG uses the term,
 *     but it plays the same structural role (pre-threshold DoG response).
 */
export interface ADoGProcessingResult extends DoGProcessingResult {
  /** Per-pixel adaptive contrast sensitivity ρ(x), Eq. (5) */
  rhoMap: ChannelImage;
  /** Input after adaptive noise injection (Eq. 6), or the original input if noiseScaleC === 0 */
  noisyInput: ChannelImage;
}



/**
 * Interface for DoG processors (XDoG, FDoG, ADoG, or HDoG)
 */
export interface DoGImplementation {
  process(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<ChannelImage>;

  /** Process and return all intermediate results (avoids redundant blur operations) */
  processDetailed(input: ChannelImage, overrides?: Partial<DoGConfig>): Promise<DoGProcessingResult>;

  dispose(): void;
}


export interface ParamRange {
  hardMin: number;
  hardMax: number;
  recommendedMin: number;
  recommendedMax: number;
  default: number;
  step: number;
}

export type DogConfigParamType = 'sigma' | 'k' | 'p' | 'epsilon' | 'phi';

/**
 * Base DoG / XDoG parameter ranges.
 *
 * Recommended ranges follow the span of settings in Table A.1 of
 * Winnemöller et al., "XDoG: An eXtended difference-of-Gaussians
 * compendium" (Computers & Graphics 36(6), 2012), which is the reference
 * for the reparameterized (σ, k, p, φ, ε) formulation used here. In that
 * table p ranges 15.7–120, φ ranges 0.01–10.3 (with φ >> 0.01 pushing the
 * soft tanh ramp toward a step function — Sec. 4.1), and ε ranges 72.6–100
 * on the paper's 0–100 luminance scale, i.e. ~0.73–1.0 once normalized.
 * σe (== `sigma` here) ranges 0.8–6.8 across natural-media styles.
 * k = 1.6 is Marr & Hildreth's engineering trade-off (Sec. 2.3).
 */
export const DOG_PARAM_RANGES: Record<DogConfigParamType, ParamRange> = {
  sigma:   { hardMin: 0,   hardMax: Infinity, recommendedMin: 0.4,  recommendedMax: 7.0,  default: 1.0, step: 0.1 },
  k:       { hardMin: 1.0, hardMax: Infinity, recommendedMin: 1.4,  recommendedMax: 1.6,  default: 1.6, step: 0.01 },
  p:       { hardMin: 0,   hardMax: Infinity, recommendedMin: 0,    recommendedMax: 120,  default: 20,  step: 1 },
  epsilon: { hardMin: 0,   hardMax: 1,        recommendedMin: 0.5,  recommendedMax: 1.0,  default: 0.5, step: 0.01 },
  phi:     { hardMin: 0,   hardMax: Infinity, recommendedMin: 0.01, recommendedMax: 200,  default: 10,  step: 0.5 },
} as const;

export type XDogConfigParamType = 'kernelSizeMultiplier';

/**
 * XDoG-specific parameter ranges (on top of DOG_PARAM_RANGES).
 *
 * kernelSizeMultiplier is the Gaussian truncation radius as a multiple of
 * σ. Winnemöller samples the Gaussian out to ~2σ for the DoG passes
 * (Appendix A/B), but a wider window (≈6σ) captures the tail more fully;
 * 3σ covers ~99.7% and is the practical floor for a clean kernel.
 */
export const XDOG_PARAM_RANGES: Record<DogConfigParamType | XDogConfigParamType, ParamRange> = {
  ...DOG_PARAM_RANGES,
  kernelSizeMultiplier: { hardMin: 1, hardMax: Infinity, recommendedMin: 3, recommendedMax: 8, default: 6, step: 1 },
} as const;

/**
 * FDoG-specific parameter ranges (on top of DOG_PARAM_RANGES).
 *
 * Ranges follow Table A.1: σc 0.10–5.84, σm 3.2–20, σa 0.6–7.2. σe is the
 * base `sigma` and keeps its DOG_PARAM_RANGES entry. Defaults track the
 * paper's more conservative line-drawing settings rather than the extreme
 * pastel/woodcut ends of the table.
 */
export type FDogConfigParamType = 'sigmaC' | 'sigmaM' | 'sigmaA';
export const FDOG_PARAM_RANGES: Record<DogConfigParamType | FDogConfigParamType, ParamRange> = {
  ...DOG_PARAM_RANGES,
  sigmaC: { hardMin: 0, hardMax: Infinity, recommendedMin: 0.1, recommendedMax: 6.0,  default: 2.5, step: 0.1 },
  sigmaM: { hardMin: 0, hardMax: Infinity, recommendedMin: 3.0, recommendedMax: 20.0, default: 4.0, step: 0.5 },
  sigmaA: { hardMin: 0, hardMax: Infinity, recommendedMin: 0.5, recommendedMax: 7.2,  default: 1.0, step: 0.1 },
} as const;

/**
 * ADoG parameter ranges.
 *
 * ADoG overrides several base ranges to match its own operating regime
 * (Gaussian Image Binarization, Sec. 3.2):
 *   - k: fixed by σs = 1.6σc, so the recommended band tightens to 1.6.
 *   - epsilon/phi: ADoG binarizes with a HARD threshold, so ε sits low
 *     (screentone primitives are dark-on-white) and φ is driven high to
 *     approximate a step function. These differ from the base DoG ranges,
 *     which are tuned for XDoG's soft tone-mapping.
 *   - tau, s, noiseScaleC: ADoG's own contrast-sensitivity and noise knobs.
 */
export type ADogConfigParamType = 'tau' | 's'| 'noiseScaleC' | 'kernelSizeMultiplier';
export const ADOG_PARAM_RANGES: Record<DogConfigParamType | ADogConfigParamType, ParamRange> = {
  ...DOG_PARAM_RANGES,
  kernelSizeMultiplier: XDOG_PARAM_RANGES.kernelSizeMultiplier,
  k:       { hardMin: 1.0, hardMax: Infinity, recommendedMin: 1.6, recommendedMax: 1.6, default: 1.6, step: 0.01 },
  epsilon: { hardMin: 0, hardMax: 1, recommendedMin: 0.0,  recommendedMax: 0.2, default: 0.05, step: 0.01 },
  phi:     { hardMin: 0, hardMax: Infinity, recommendedMin: 100, recommendedMax: 200, default: 200, step: 5 },
  tau: { hardMin: 0, hardMax: 1, recommendedMin: 0.97, recommendedMax: 1.0, default: 0.99, step: 0.005 },
  s:   { hardMin: 0, hardMax: Infinity, recommendedMin: 0.5, recommendedMax: 5.0, default: 2.0, step: 0.1 },
  noiseScaleC: { hardMin: 0, hardMax: Infinity, recommendedMin: 0, recommendedMax: 0.05, default: 0.01, step: 0.005 },
} as const;

export type HDogConfigParamType  = ADogConfigParamType | 'adogSecondaryScaleFactor';

/** HDoG shares ADoG's parameter regime (its screentone passes are ADoG). */
export const HDOG_PARAM_RANGES: Record<DogConfigParamType | HDogConfigParamType, ParamRange> = {
  ...ADOG_PARAM_RANGES,
  adogSecondaryScaleFactor: { hardMin: 1.0, hardMax: Infinity, recommendedMin: 2.0, recommendedMax: 6.0, default: 4.0, step: 0.25 },
} as const;

/**
 * Default DoG configuration values
 * Based on paper's recommendations and Appendix A parameter ranges
 */
export const DEFAULT_DOG_CONFIG: DoGConfig = {
  sigma: DOG_PARAM_RANGES.sigma.default,
  k: DOG_PARAM_RANGES.k.default,
  p: DOG_PARAM_RANGES.p.default,       // Strong edge emphasis suitable for most styles
  epsilon: DOG_PARAM_RANGES.epsilon.default,  // Mid-tone threshold (normalized 0-1)
  phi: DOG_PARAM_RANGES.phi.default,     // Moderately sharp 
  thresholdStrategy: new SoftThresholdStrategy()
};

/**
 * Default FDoG configuration values
 * Based on Table A.1 in the paper
 */
export const DEFAULT_FDOG_CONFIG: FDoGConfig = {
  ...DEFAULT_DOG_CONFIG,
  sigmaC: FDOG_PARAM_RANGES.sigmaC.default,   // Structure tensor smoothing
  sigmaM: FDOG_PARAM_RANGES.sigmaM.default,   // Flow-aligned smoothing
  sigmaA: FDOG_PARAM_RANGES.sigmaA.default,   // Anti-aliasing,
  thresholdStrategy: new HardThresholdStrategy()
};

/**
 * Default ADoG configuration values
 * Based on Section 3.2 of "Gaussian Image Binarization"
 * (σc = 1.0, σs = 1.6σc, τ = 0.99, s = 2.0, noise c = 0.01)
 */
export const DEFAULT_ADOG_CONFIG: ADoGConfig = {
  ...DEFAULT_DOG_CONFIG,
  sigma: ADOG_PARAM_RANGES.sigma.default,
  k: ADOG_PARAM_RANGES.k.default,
  epsilon: ADOG_PARAM_RANGES.epsilon.default,  // Low: dark screentone primitives on white
  phi: ADOG_PARAM_RANGES.phi.default,          // High: hard-threshold / near step function
  tau: ADOG_PARAM_RANGES.tau.default,
  s: ADOG_PARAM_RANGES.s.default,
  noiseScaleC: ADOG_PARAM_RANGES.noiseScaleC.default,
  kernelSizeMultiplier: XDOG_PARAM_RANGES.kernelSizeMultiplier.default,
  thresholdStrategy: new HardThresholdStrategy(),
};

/**
 * Default HDoG configuration values
 * s' defaults to 4s per the paper's empirical setting (Eq. 9)
 */
export const DEFAULT_HDOG_CONFIG: HDoGConfig = {
  fdog: {},
  adog: {},
  adogSecondaryScaleFactor: 4,
};

/**
 * Preset configurations for common styles from the paper
 */
export const STYLE_PRESETS: Record<string, DoGConfig> = {
  /**
   * Pencil shading style (Figure 1b, Section 5.2)
   * High-frequency detail resembling graphite on paper
   */
  pencilShading: {
    sigma: 0.4,
    k: 1.6,
    p: 20,
    epsilon: 0.5,
    phi: 0.01,  // Very soft threshold for gradual tones
  } as DoGConfig,
  
  /**
   * Pastel style (Figure 18b, Section 5.2)
   * Intermediate edge width with flow turbulence
   */
  pastel: {
    sigma: 2.0,
    k: 1.6,
    p: 40,
    epsilon: 1.0,  // High threshold (mostly white)
    phi: 0.01,
  } as DoGConfig,
  
  /**
   * Charcoal style (Figure 18c, Section 5.2)
   * Broad strokes from large spatial support
   */
  charcoal: {
    sigma: 7.0,
    k: 1.6,
    p: 70,
    epsilon: 0.8,
    phi: 0.01,
  } as DoGConfig,
  
  /**
   * Thresholding / line art (Section 4.1)
   * Clean black and white edges
   */
  threshold: {
    sigma: 1.4,
    k: 1.6,
    p: 20,
    epsilon: 0.78,
    phi: 100,  // Very sharp threshold (near step function)
  } as DoGConfig,
  
  /**
   * Woodcut style (Section 4.2, Figure 15)
   * Aggressive flow distortion with extreme edge emphasis
   */
  woodcut: {
    sigma: 0.8,
    k: 1.6,
    p: 120,    // Extreme edge emphasis
    epsilon: 0.73,
    phi: 100,  // Hard threshold
  } as DoGConfig,
} as const;

/**
 * Preset FDoG configurations including flow parameters
 */
export const FDOG_STYLE_PRESETS: Record<string, FDoGConfig> = {
  /**
   * Standard FDoG for coherent line drawing (Figure 2g)
   */
  standard: {
    ...STYLE_PRESETS.threshold,
    sigmaC: 2.28,
    sigmaM: 4.4,
    sigmaA: 1.0,
  } as FDoGConfig,
  
  /**
   * Pastel with flow (Figure 18b)
   */
  pastel: {
    ...STYLE_PRESETS.pastel,
    sigmaC: 0.1,   // Minimal structure tensor smoothing
    sigmaM: 20,    // Large flow smoothing for turbulence
    sigmaA: 7.2,
  } as FDoGConfig,
  
  /**
   * Woodcut with aggressive flow (Figure 15)
   */
  woodcut: {
    ...STYLE_PRESETS.woodcut,
    sigmaC: 5.84,
    sigmaM: 3.2,
    sigmaA: 0.75,
  } as FDoGConfig,
} as const;

/**
 * Preset ADoG configurations
 * (No presets given directly in the paper's tables beyond the defaults
 * above; add named presets here as you tune them, e.g. denser/lighter
 * screentone variants.)
 */
export const ADOG_STYLE_PRESETS: Record<string, ADoGConfig> = {
  standard: {
    ...DEFAULT_ADOG_CONFIG,
  } as ADoGConfig,
} as const;

export const HDOG_STYLE_PRESETS: Record<string, HDoGConfig> = {
  /**
   * Paper defaults (Sec. 3.1–3.3): σc=1.0, k=1.6 (σs=1.6σc), σm=3.0,
   * σa≈1.0 (not explicitly stated as a default in the paper's FDoG
   * section, so this uses a light anti-aliasing value), τ=0.99, s=2.0,
   * noiseScaleC=0.01, s'=4s. This is the closest match to Figs. 13–14.
   */
  default: {
    fdog: DEFAULT_FDOG_CONFIG,
    adog: DEFAULT_ADOG_CONFIG,
    adogSecondaryScaleFactor: 4,
  }
} as const;