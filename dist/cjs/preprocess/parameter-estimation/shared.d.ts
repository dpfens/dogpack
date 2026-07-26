/**
 * Shared per-pixel parameter estimation techniques, used by epsilon.ts,
 * p.ts, and phi.ts to build spatially-varying ChannelImage maps for any of
 * XDoG/FDoG/ADoG's `p`/`epsilon`/`phi` config fields (all typed
 * `number | ChannelImage` -- see DoGConfig in ../../interfaces/dog.js).
 *
 * Four techniques, each keyed to a different signal:
 *
 *   - toneAdaptiveEstimate: interpolate between a "dark" and "light" value
 *     over blurred local tone. Principled for epsilon (S(x) collapses to
 *     local tone in flat regions, per Eq. 7 -- see epsilon.ts). For p/phi
 *     it's available but only as a stylistic option; neither has an
 *     equation tying it to brightness.
 *
 *   - localBaselineEstimate: track a blurred local baseline of the input
 *     directly (+ optional offset/variance margin). Principled for
 *     epsilon specifically -- it's a direct read of the quantity epsilon
 *     is thresholded against, not just a plausible curve.
 *
 *   - magnitudeAdaptiveEstimate: interpolate over local gradient
 *     magnitude. Principled for p -- p multiplies the edge term D(x) =
 *     blur1(x) - blur2(x), which is ~0 in flat regions regardless of
 *     brightness and grows only where there's real gradient structure.
 *
 *   - varianceAdaptiveEstimate: interpolate over local variance.
 *     Principled for phi -- hard-vs-soft threshold steepness plausibly
 *     tracks "is there already texture/detail here," independent of tone.
 *
 * See each parameter file's own module comment for which technique(s) are
 * actually motivated for that parameter -- this file just holds the
 * mechanics.
 */
import type { ChannelImage, LocalBaselineOptions, MagnitudeAdaptiveOptions, ToneAdaptiveAutoOptions, ToneAdaptiveOptions, VarianceAdaptiveOptions } from '../../interfaces/base.js';
/** value(x) = low + (high - low) * tanh(s * localTone(x)) */
export declare function toneAdaptiveEstimate(input: ChannelImage, options: ToneAdaptiveOptions): Promise<ChannelImage>;
/** Convenience: derive low/high from a center + spread instead of picking both by hand. */
export declare function toneAdaptiveEstimateAuto(input: ChannelImage, options: ToneAdaptiveAutoOptions): Promise<ChannelImage>;
/** value(x) = blur(input, sigma)(x) + offset [+ contrastMargin * localStdDev(x)] */
export declare function localBaselineEstimate(input: ChannelImage, options: LocalBaselineOptions): Promise<ChannelImage>;
/** value(x) = low + (high - low) * normalizedGradientMagnitude(x)^gamma */
export declare function magnitudeAdaptiveEstimate(input: ChannelImage, options: MagnitudeAdaptiveOptions): Promise<ChannelImage>;
/** value(x) = low + (high - low) * normalizedLocalVariance(x)^gamma */
export declare function varianceAdaptiveEstimate(input: ChannelImage, options: VarianceAdaptiveOptions): Promise<ChannelImage>;
//# sourceMappingURL=shared.d.ts.map