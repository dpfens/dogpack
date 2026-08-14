/**
 * Epsilon parameter estimation
 *
 * XDoG/FDoG/ADoG threshold their continuous sharpened response against a
 * scalar `epsilon`. A fixed epsilon under-serves one tone extreme or the
 * other on high-dynamic-range input.
 *
 * Why epsilon should track local tone (from processor.ts's Eq. 7):
 * S(x) = (1+p)*blur1(x) - p*blur2(x). In flat regions blur1(x) ≈ blur2(x)
 * ≈ local brightness, so S(x) itself sits near local tone there. A flat
 * epsilon tuned for midtones crushes bright regions to white and dark
 * regions to black. For epsilon to threshold something meaningful
 * everywhere, it has to move with local tone -- lower in dark
 * neighborhoods, higher in light ones.
 *
 * Both `toneAdaptiveEstimate` and `localBaselineEstimate` below are
 * principled for epsilon specifically: tone tracking approximates S(x),
 * and local-baseline tracking reads it more directly. See shared.ts for
 * the mechanics, and p.ts/phi.ts for why a *different* signal (not tone)
 * is the principled choice for those parameters instead.
 */

import type { ChannelImage, LocalBaselineOptions, ToneAdaptiveAutoOptions, ToneAdaptiveOptions } from '../../interfaces/base.js';
import { createChannelImage } from '../../utils/image.js';
import * as shared from './shared.js';

export async function toneAdaptiveEstimate(
  input: ChannelImage,
  options: Omit<ToneAdaptiveOptions, 'low' | 'high'> & { epsilonDark: number; epsilonLight: number }
): Promise<ChannelImage> {
  const { epsilonDark, epsilonLight, ...rest } = options;
  return shared.toneAdaptiveEstimate(input, { ...rest, low: epsilonDark, high: epsilonLight });
}

export async function toneAdaptiveEstimateAuto(
  input: ChannelImage,
  options: Omit<ToneAdaptiveAutoOptions, 'higherInLight'> & { denserInDark?: boolean }
): Promise<ChannelImage> {
  const { denserInDark = true, ...rest } = options;
  return shared.toneAdaptiveEstimateAuto(input, { ...rest, higherInLight: denserInDark });
}

/**
 * Recommended default: epsilon as the local baseline of the sharpened
 * response. `sigma` should track the DoG's own sigma (this is what
 * `computeSharpening()` actually produces in flat regions).
 */
export async function localBaselineEstimate(
  input: ChannelImage,
  options: LocalBaselineOptions
): Promise<ChannelImage> {
  return shared.localBaselineEstimate(input, options);
}

/**
 * Spatially-varying epsilon map for ADoG specifically. Unlike the generic
 * epsilon.localBaselineEstimate (principled for XDoG's S(x) ≈ localTone),
 * ADoG's flat-region response is I(x) * (1-p(x)) = I(x) * (1-τ) * tanh(s * I(x)),
 * bounded by (1-τ) rather than 1 (see Eq. 4/5). This pre-scales the input
 * by that closed form before handing it to the same blur/offset/
 * contrastMargin machinery shared.localBaselineEstimate already provides.
 */
export async function adogLocalBaselineEstimate(
  input: ChannelImage,
  options: LocalBaselineOptions & { tau: number; s: number }
): Promise<ChannelImage> {
  const { tau, s, ...baseOptions } = options;
  const scaled = createChannelImage(input.width, input.height);
  for (let i = 0; i < input.data.length; i++) {
    const I = input.data[i];
    scaled.data[i] = I * (1 - tau) * Math.tanh(s * I);
  }
  return shared.localBaselineEstimate(scaled, baseOptions);
}

/**
 * Usage:
 *
 *   import { XDoG } from '../../implementations/xdog.js';
 *   import { ScalarField } from '../../utils/scalar-field.js';
 *   import { localBaselineEstimate } from './epsilon.js';
 *
 *   const epsilonMap = await localBaselineEstimate(input, { sigma: 1.4 });
 *   const result = await new XDoG({ sigma: 1.4, k: 1.6, phi: 10 }).process(input, {
 *     epsilon: ScalarField.fromChannelImage(epsilonMap),
 *   });
 */
