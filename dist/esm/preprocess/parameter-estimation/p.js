/**
 * p (sharpening strength) parameter estimation
 *
 * p multiplies the edge term in Eq. 7: S(x) = blur1(x) + p*D(x), where
 * D(x) = blur1(x) - blur2(x). D(x) is ~0 in flat regions regardless of
 * brightness, and grows only where there's real gradient structure. So a
 * spatially-varying p should track *gradient magnitude*, not tone --
 * `magnitudeAdaptiveEstimate` below is the principled default.
 *
 * `toneAdaptiveEstimate`/`toneAdaptiveEstimateAuto` are also exposed, but
 * unlike epsilon.ts's use of the same technique, they're NOT derived from
 * anything -- there's no equation tying p to brightness. Use only if you
 * deliberately want a brightness-driven look and know that's the choice
 * you're making.
 *
 * If using FDoG with an ETF already computed, prefer its
 * `confidenceWeighting.pByMagnitude` (../../interfaces/dog.js) instead --
 * same idea, smoothed/refined magnitude rather than a raw gradient.
 */
import * as shared from './shared.js';
/** Recommended default. p(x) = pWeak + (pStrong - pWeak) * normalizedGradientMagnitude(x)^gamma */
export async function magnitudeAdaptiveEstimate(input, options) {
    const { pWeak, pStrong, ...rest } = options;
    return shared.magnitudeAdaptiveEstimate(input, { ...rest, low: pWeak, high: pStrong });
}
/** Stylistic only -- NOT derived from Eq. 7. See module comment. */
export async function toneAdaptiveEstimate(input, options) {
    const { pDark, pLight, ...rest } = options;
    return shared.toneAdaptiveEstimate(input, { ...rest, low: pDark, high: pLight });
}
/** Stylistic only -- NOT derived from Eq. 7. See module comment. */
export async function toneAdaptiveEstimateAuto(input, options) {
    return shared.toneAdaptiveEstimateAuto(input, options);
}
/**
 * Usage:
 *
 *   import { XDoG } from '../../implementations/xdog.js';
 *   import { ScalarField } from '../../utils/scalar-field.js';
 *   import { magnitudeAdaptiveEstimate } from './p.js';
 *
 *   const pMap = await magnitudeAdaptiveEstimate(input, { pWeak: 5, pStrong: 40 });
 *   const result = await new XDoG({ sigma: 1.4, k: 1.6, epsilon: 0.78 }).process(input, {
 *     p: ScalarField.fromChannelImage(pMap),
 *   });
 */
//# sourceMappingURL=p.js.map