/**
 * Declarative description of a single preprocessing step.
 *
 * The component only ever produces arrays of these - it never touches
 * PreprocessingPipeline's fluent `.bilateral().kuwahara()` API directly.
 * The service is what turns a PipelineStepConfig[] into an actual
 * PreprocessingPipeline.
 */

import type {
  BilateralFilterConfig,
  MedianFilterConfig,
  KuwaharaFilterConfig,
} from 'dogpack';

/**
 * Whether the pipeline runs independently on all three RGB channels, or
 * on a single derived luminance channel (cheaper, and the more common
 * choice feeding into XDoG/FDoG line detection).
 */
export type ChannelMode = 'rgb' | 'luminance';

export type PipelineStepConfig =
  | { type: 'bilateral'; config?: Partial<BilateralFilterConfig> }
  | { type: 'median'; config?: Partial<MedianFilterConfig> }
  | { type: 'kuwahara'; config?: Partial<KuwaharaFilterConfig> }
  | { type: 'gaussian'; sigma?: number }
  | { type: 'contrast'; blackPoint?: number; whitePoint?: number }
  | { type: 'quantize'; levels?: number }
  | { type: 'preset'; name: keyof PresetName };

// Mirrors the keys of PreprocessingPresets in dogpack, kept as a separate
// type here so this file doesn't need to import the presets object just
// to name its keys.
export interface PresetName {
  light: unknown;
  standard: unknown;
  heavy: unknown;
  artistic: unknown;
  nature: unknown;
}

/** Human-readable labels, handy for populating a <select> in the template. */
export const PIPELINE_STEP_LABELS: Record<PipelineStepConfig['type'], string> = {
  bilateral: 'Bilateral Filter',
  median: 'Median Filter',
  kuwahara: 'Kuwahara Filter',
  gaussian: 'Gaussian Blur',
  contrast: 'Contrast Enhance',
  quantize: 'Quantize',
  preset: 'Preset',
};