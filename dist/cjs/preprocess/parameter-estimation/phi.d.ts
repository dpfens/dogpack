/**
 * phi (soft-threshold steepness) parameter estimation
 *
 * phi controls tanh steepness of the soft threshold (low phi = gradual
 * pencil shading, high phi = near step function). No equation ties it to
 * brightness, but local variance is a plausible signal: a neighborhood
 * that already has real detail is a reasonable candidate for hard edges;
 * a flat neighborhood, for soft shading -- independent of tone.
 * `varianceAdaptiveEstimate` below is the principled default.
 *
 * `toneAdaptiveEstimate`/`toneAdaptiveEstimateAuto` are exposed as a
 * labeled stylistic option only (same caveat as p.ts) -- not derived from
 * anything.
 *
 * Note: `HardThresholdStrategy` (ADoG/FDoG's default) ignores `phi`
 * entirely -- a spatially-varying phi only matters under
 * `SoftThresholdStrategy`.
 */
import type { ChannelImage, ToneAdaptiveAutoOptions, ToneAdaptiveOptions, VarianceAdaptiveOptions } from '../../interfaces/base.js';
/** Recommended default. phi(x) = phiSoft + (phiHard - phiSoft) * normalizedVariance(x)^gamma */
export declare function varianceAdaptiveEstimate(input: ChannelImage, options: Omit<VarianceAdaptiveOptions, 'low' | 'high'> & {
    phiSoft: number;
    phiHard: number;
}): Promise<ChannelImage>;
/** Stylistic only -- not derived from anything. See module comment. */
export declare function toneAdaptiveEstimate(input: ChannelImage, options: Omit<ToneAdaptiveOptions, 'low' | 'high'> & {
    phiDark: number;
    phiLight: number;
}): Promise<ChannelImage>;
/** Stylistic only -- not derived from anything. See module comment. */
export declare function toneAdaptiveEstimateAuto(input: ChannelImage, options: ToneAdaptiveAutoOptions): Promise<ChannelImage>;
/**
 * Usage:
 *
 *   import { XDoG } from '../../implementations/xdog.js';
 *   import { ScalarField } from '../../utils/scalar-field.js';
 *   import { varianceAdaptiveEstimate } from './phi.js';
 *
 *   const phiMap = await varianceAdaptiveEstimate(input, { sigma: 3, phiSoft: 0.01, phiHard: 50 });
 *   const result = await new XDoG({ sigma: 1.4, k: 1.6, epsilon: 0.78 }).process(input, {
 *     phi: ScalarField.fromChannelImage(phiMap),
 *   });
 */
//# sourceMappingURL=phi.d.ts.map