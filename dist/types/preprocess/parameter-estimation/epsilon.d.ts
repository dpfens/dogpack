import type { ChannelImage, LocalBaselineEpsilonOptions, ToneAdaptiveEpsilonOptions } from '../../interfaces/base.js';
/**
 * Estimate a spatially-varying epsilon ChannelImage from local image tone.
 *
 * epsilon(x) = epsilonDark + (epsilonLight - epsilonDark) * tanh(s * localTone(x))
 *
 * Note tanh(s) doesn't quite reach 1 (e.g. tanh(2) ≈ 0.964), so the lightest
 * areas land close to, but not exactly at, epsilonLight -- same approximation
 * the paper accepts for rho(x) in Eq. (5), and generally not worth correcting
 * for since epsilonDark/epsilonLight are empirically tuned anyway.
 */
export declare function toneAdaptiveEstimate(input: ChannelImage, options: ToneAdaptiveEpsilonOptions): Promise<ChannelImage>;
/**
 * Estimate epsilon directly as the local baseline of the sharpened response,
 * instead of interpolating between two hand-picked epsilonDark/epsilonLight
 * constants. Since S(x) ≈ local tone in flat regions (Eq. 7, see module
 * comment), blurring the input at the DoG's own `sigma` is a direct estimate
 * of that baseline -- this is `estimateToneAdaptiveEpsilon` with the tanh
 * shaping and two free endpoints removed, in favor of just tracking the
 * quantity epsilon is actually being compared against. Prefer this one
 * unless you specifically want the tanh curve's asymmetric dark/light
 * control (e.g. for a stylized look rather than a technically-motivated one).
 */
export declare function localBaselineEstimate(input: ChannelImage, options: LocalBaselineEpsilonOptions): Promise<ChannelImage>;
/**
 * Usage (recommended default -- tracks the DoG's own blur directly):
 *
 *   import { XDoG } from '../implementations/xdog.js';
 *   import { ScalarField } from './scalar-field.js';
 *   import { estimateLocalBaselineEpsilon } from './adaptive-epsilon.js';
 *
 *   const sigma = 1.4;
 *   const epsilonMap = await estimateLocalBaselineEpsilon(input, { sigma });
 *
 *   const xdog = new XDoG({ sigma, k: 1.6, phi: 10 });
 *   const result = await xdog.process(input, {
 *     epsilon: ScalarField.fromChannelImage(epsilonMap),
 *   });
 *
 * Usage (tanh-shaped, for hand-tuned dark/light control instead):
 *
 *   import { ADoG } from '../implementations/adog.js';
 *   import { estimateToneAdaptiveEpsilonAuto } from './adaptive-epsilon.js';
 *
 *   const center = await ADoG.estimateEpsilon(input); // reuse existing global estimator
 *   const epsilonMap = await estimateToneAdaptiveEpsilonAuto(input, {
 *     center,
 *     spread: center * 0.15,
 *     localitySigma: 12,
 *   });
 *
 * Works the same way for FDoG/ADoG: `DoGConfig`'s p/epsilon/phi are
 * ScalarFields internally (see utils/scalar-field.ts), so any of them
 * accept a wrapped ChannelImage like this one as a config override.
 */
//# sourceMappingURL=epsilon.d.ts.map