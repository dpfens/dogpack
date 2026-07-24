/**
 * pipeline-help-content.ts
 *
 * Single source of truth for end-user-facing help text in the pipeline
 * builder.
 */

export interface ParamHint {
  label: string;
  hint: string;
}

interface RangeLike {
  recommendedMin: number;
  recommendedMax: number;
}

/** Appends "Recommended X–Y." to a description, matching the existing
 * `∞` handling in DogComponent.hint(). Shared so every component's hint()
 * formats the range suffix identically. */
export function withRange(description: string, r: RangeLike): string {
  const max = r.recommendedMax === Infinity ? '∞' : r.recommendedMax;
  return `${description} Recommended ${r.recommendedMin}–${max}.`;
}

// ---------------------------------------------------------------------------
// Base DoG params (DogConfigParamType) rendered by <dog>, embedded inside
// xdog.html / fdog.html / adog.html alike.
// ---------------------------------------------------------------------------

export const DOG_PARAM_HINTS: Record<'sigma' | 'k' | 'p' | 'epsilon' | 'phi', ParamHint> = {
  sigma: {
    label: 'Sigma (base blur)',
    hint: 'How wide the first blur pass is. Bigger sigma finds thicker, larger-scale edges; smaller sigma catches fine detail.',
  },
  k: {
    label: 'k (blur ratio)',
    hint: 'How much wider the second blur is compared to the first (second blur = sigma × k). This gap between the two blurs is what actually finds the edges; bigger k finds bolder, more separated lines.',
  },
  p: {
    label: 'p (sharpening strength)',
    hint: 'How aggressively the edge response is exaggerated before thresholding. Higher makes edges punchier and more graphic; 0 disables sharpening.',
  },
  epsilon: {
    label: 'Epsilon (white/black threshold)',
    hint: 'The tone level that separates "line" from "background." Raise it to keep more of the image as line; lower it to keep only the strongest edges.',
  },
  phi: {
    label: 'Phi (threshold sharpness)',
    hint: 'How abrupt the white-to-black transition is at the Epsilon cutoff. Low phi gives a soft, ink-like fade; high phi is nearly flat black/white. (Ignored by Hard and Hysteresis threshold strategies below.)',
  },
};

// ---------------------------------------------------------------------------
// Threshold strategy — dog.ts's strategyOptions ('Soft' | 'Hard' | 'Hysteresis')
// ---------------------------------------------------------------------------

export interface ThresholdStrategyInfo {
  key: 'Soft' | 'Hard' | 'Hysteresis';
  label: string;
  hint: string;
}

export const THRESHOLD_STRATEGIES: ThresholdStrategyInfo[] = [
  {
    key: 'Soft',
    label: 'Soft',
    hint: 'Fades smoothly between black and white at the edge, using Phi to control how gradual the fade is. Good general default which looks like ink rather than a flat digital cutout.',
  },
  {
    key: 'Hard',
    label: 'Hard',
    hint: 'Every pixel becomes fully black or fully white Phi is ignored. Cleanest, most graphic/poster-like result.',
  },
  {
    key: 'Hysteresis',
    label: 'Hysteresis',
    hint: 'Uses a strict cutoff and a looser cutoff together: anything past the strict one is kept automatically; anything only in the looser range is kept only if it touches a confirmed line. Cuts down on stray noise specks while preserving faint stretches of a real line. Phi is ignored; see High/Low offset instead.',
  },
];

export function findThresholdStrategy(key: string): ThresholdStrategyInfo | undefined {
  return THRESHOLD_STRATEGIES.find((s) => s.key === key);
}

export const HYSTERESIS_PARAM_HINTS: Record<'highOffset' | 'lowOffset', ParamHint> = {
  highOffset: {
    label: 'High offset',
    hint: 'Distance above Epsilon a pixel must clear to count as a definite line on its own. Lower this to seed more strong lines.',
  },
  lowOffset: {
    label: 'Low offset',
    hint: 'Distance below Epsilon a pixel can still be and count as a "maybe" line, if it touches a definite line. Raise this to keep more faint, connected line segments.',
  },
};

// ---------------------------------------------------------------------------
// XDoG extras (XDogConfigParamType: kernelSizeMultiplier) + blur strategy
// ---------------------------------------------------------------------------

export const XDOG_EXTRA_PARAM_HINTS: Record<'kernelSizeMultiplier', ParamHint> = {
  kernelSizeMultiplier: {
    label: 'Kernel size multiplier',
    hint: 'How far the blur\u2019s Gaussian kernel extends before it\u2019s cut off, as a multiple of sigma. Higher is more accurate but slower; lower is faster but can look slightly boxy at large sigma values.',
  },
};

/** Keyed by BlurType ('Isotropic' for now — extend alongside blurOptions in xdog.ts). */
export const BLUR_STRATEGY_HINTS: Record<string, string> = {
  Isotropic: 'Blurs evenly in every direction. The standard, predictable choice and the fastest blur strategy.',
};

// ---------------------------------------------------------------------------
// ADoG extras (ADogConfigParamType: tau, s, noiseScaleC, kernelSizeMultiplier)
// ---------------------------------------------------------------------------

export const ADOG_EXTRA_PARAM_HINTS: Record<'tau' | 's' | 'noiseScaleC' | 'kernelSizeMultiplier', ParamHint> = {
  tau: {
    label: '\u03c4 (minimum contrast sensitivity)',
    hint: 'Floors how much the adaptive weighting can suppress the second blur in bright areas. Higher tau keeps ADoG closer to plain DoG everywhere; lower tau lets bright, high-tone regions fade out more.',
  },
  s: {
    label: 's (tone falloff steepness)',
    hint: 'How sharply the adaptive weighting (and, if noise is enabled, the injected noise) responds to local brightness. Higher values create a more sudden transition between "shaded" and "line" regions.',
  },
  noiseScaleC: {
    label: 'c (adaptive noise scale)',
    hint: 'Amount of tone-adaptive noise injected before blurring. This is what produces the dotted screentone texture in shaded areas. Set to 0 to disable and get plain adaptive DoG without texture.',
  },
  kernelSizeMultiplier: XDOG_EXTRA_PARAM_HINTS.kernelSizeMultiplier,
};

// ---------------------------------------------------------------------------
// FDoG extras (FDogConfigParamType: sigmaC, sigmaM, sigmaA)
// ---------------------------------------------------------------------------

export const FDOG_EXTRA_PARAM_HINTS: Record<'sigmaC' | 'sigmaM' | 'sigmaA' | 'epsilonMargin', ParamHint> = {
  sigmaC: {
    label: '\u03c3c (structure tensor smoothing)',
    hint: 'Controls how smooth the detected flow field (the image\u2019s "grain" direction) is before edges are traced along it. Higher gives longer, more coherent strokes; lower follows fine texture more literally.',
  },
  sigmaM: {
    label: '\u03c3m (flow-aligned smoothing)',
    hint: 'Smooths the line output along the flow direction after edge detection, joining up broken strokes into longer, more continuous lines. 0 disables this pass.',
  },
  sigmaA: {
    label: '\u03c3a (anti-aliasing LIC)',
    hint: 'Optional final smoothing pass along the flow field to soften jagged pixel edges. 0 disables it.',
  },
  epsilonMargin: {
    label: '\u03c3a Epsilon margin',
    hint: 'Optional value indiating the.',
  },
};

// ---------------------------------------------------------------------------
// HDoG extras (HDogConfigParamType: adogSecondaryScaleFactor)
// ---------------------------------------------------------------------------

export const HDOG_EXTRA_PARAM_HINTS: Record<'adogSecondaryScaleFactor', ParamHint> = {
  adogSecondaryScaleFactor: {
    label: "s' scale factor (secondary ADoG)",
    hint: 'HDoG runs two ADoG passes and keeps only pixels both agree on. This multiplies the primary pass\u2019s s (tone falloff steepness) to get the second pass\u2019s s\u2019, giving two different shading layers instead of one. 1.0 makes both passes identical.',
  },
};

// TODO / gap: DoG style presets
export const DOG_STYLE_PRESET_HINTS: Record<string, string> = {
  // e.g. manga: 'Bold, high-contrast lines with heavy screentone shading.',
};

export function dogPresetHint(name: string): string | undefined {
  return DOG_STYLE_PRESET_HINTS[name];
}

// ---------------------------------------------------------------------------
// Node types — layer.ts's `nodeTypes` ('layer' | 'xdog' | 'fdog' | 'adog' | 'hdog')
// ---------------------------------------------------------------------------

export type DogNodeKind = 'layer' | 'xdog' | 'fdog' | 'adog' | 'hdog';

export interface NodeTypeInfo extends ParamHint {
  /** One line, fits a dropdown item without inflating menu height. Use this
   * in layer.html's "Add node" dropdown; use `hint` (the long form) for the
   * badge [title] tooltip instead. */
  shortHint: string;
}

export const NODE_TYPE_INFO: Record<DogNodeKind, NodeTypeInfo> = {
  layer: {
    label: 'Layer',
    shortHint: 'A nested sub-pipeline blended into its parent.',
    hint: 'A nested group: runs its own sub-pipeline of nodes and blends the combined result into its parent using the chosen blend mode. Use this to combine multiple DoG passes (e.g. crisp XDoG lines over painterly ADoG shading) rather than picking just one.',
  },
  xdog: {
    label: 'XDoG',
    shortHint: 'Classic, fast, general-purpose line detector.',
    hint: 'The classic, general-purpose line detector. Fast and predictable. A good first choice for most photos and illustrations.',
  },
  fdog: {
    label: 'FDoG',
    shortHint: 'Flow-guided, smooth hand-drawn-style lines.',
    hint: 'Flow-guided lines that follow the image\u2019s natural grain, giving smooth, hand-drawn-looking strokes. Costs more to compute than XDoG.',
  },
  adog: {
    label: 'ADoG',
    shortHint: 'Tone-adaptive, manga/screentone-style shading.',
    hint: 'Tone-adaptive, manga/screentone-style output. Sensitivity shifts with local brightness instead of one fixed cutoff everywhere.',
  },
  hdog: {
    label: 'HDoG',
    shortHint: 'FDoG lines + two ADoG shading passes combined.',
    hint: 'Combines an FDoG line pass with two ADoG shading passes into one finished comic/manga-style image. The most expensive option, since it runs all three.',
  },
};

// ---------------------------------------------------------------------------
// Preprocessing pipeline steps — reuses PIPELINE_STEP_LABELS already exported
// by models/preprocessing.ts rather than redefining labels here.
// ---------------------------------------------------------------------------

export type PipelineStepType =
  | 'bilateral'
  | 'median'
  | 'kuwahara'
  | 'gaussian'
  | 'contrast'
  | 'quantize'
  | 'preset';

export interface PipelineStepInfo {
  summary: string;
  params?: Record<string, ParamHint>;
}

export const PIPELINE_STEP_HINTS: Record<PipelineStepType, PipelineStepInfo> = {
  preset: {
    summary: 'A ready-made combination of steps tuned for a common scenario.',
  },
  bilateral: {
    summary: 'Smooths flat areas (skin, sky, walls) while keeping edges sharp. The safest general "clean up before tracing" filter.',
    params: {
      sigmaSpatial: {
        label: 'Spatial \u03c3',
        hint: 'How large an area to smooth. Higher smooths bigger regions but can start blurring real detail.',
      },
      sigmaRange: {
        label: 'Range \u03c3',
        hint: 'How different two pixels\u2019 tones need to be before they\u2019re treated as separate regions (an edge). Lower preserves more edges; higher smooths more but can blur soft edges away.',
      },
    },
  },
  median: {
    summary: 'Removes speckle / salt-and-pepper noise by replacing each pixel with the middle value of its neighborhood, without blurring the whole image.',
    params: {
      radius: {
        label: 'Radius',
        hint: 'Neighborhood size. Bigger removes more noise but can erase small details like eyelashes or fine hair strands.',
      },
    },
  },
  kuwahara: {
    summary: 'Edge-aware smoothing that produces a painterly, posterized look.  This is good for when you want the source image itself to look more illustrated before edge detection.',
    params: {
      radius: {
        label: 'Radius',
        hint: 'Size of the region considered at each pixel. Bigger gives bolder, more abstracted regions.',
      },
    },
  },
  gaussian: {
    summary: 'A plain, even blur with no edge-awareness. Useful for gently softening an image before edge detection, but it softens real edges along with noise.',
    params: {
      sigma: {
        label: 'Sigma',
        hint: 'Blur strength/radius. Higher is blurrier.',
      },
    },
  },
  contrast: {
    summary: 'Stretches contrast by pushing shadows darker and highlights lighter. Helps flat, low-contrast photos produce more decisive edges.',
    params: {
      blackPoint: { label: 'Black point', hint: 'Tones below this become pure black.' },
      whitePoint: { label: 'White point', hint: 'Tones above this become pure white.' },
    },
  },
  quantize: {
    summary: 'Collapses smooth gradients into a handful of flat tone bands.  Useful before ADoG/HDoG if you want discrete tone regions rather than continuous shading.',
    params: {
      levels: { label: 'Levels', hint: 'How many distinct tones to keep. Lower gives fewer, bolder bands.' },
    },
  },
};

// ---------------------------------------------------------------------------
// Preprocessing presets (light/standard/heavy/artistic/nature
// ---------------------------------------------------------------------------

export type PreprocessingPresetName = 'light' | 'standard' | 'heavy' | 'artistic' | 'nature';

export const PREPROCESSING_PRESET_HINTS: Record<PreprocessingPresetName, string> = {
  light: 'Minimal smoothing. Best for clean studio photos and illustrations that are already fairly noise-free.',
  standard: 'Balanced, general-purpose smoothing. Good default for most outdoor photos and portraits.',
  heavy: 'Two aggressive smoothing passes back-to-back. Best for very textured images (grass, foliage, fabric) that would otherwise produce noisy line art.',
  artistic: 'Painterly Kuwahara pass followed by a light bilateral cleanup. Best for a stylized, illustrated look rather than a photographic one.',
  nature: 'Two-pass smoothing tuned for landscapes and outdoor scenes with lots of fine natural texture.',
};