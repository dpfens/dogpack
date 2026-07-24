/**
 * Tone-adaptive epsilon estimation
 *
 * XDoG/FDoG/ADoG all threshold their (continuous) sharpened response against a
 * single scalar `epsilon`. That's fine when the image's tone is roughly uniform,
 * but a fixed epsilon under-serves one extreme or the other on high-dynamic-range
 * input: an epsilon tuned to hold onto shadow detail tends to flood highlights
 * with noise, and vice versa.
 *
 * Why epsilon needs to track local tone at all (confirmed against processor.ts):
 * `computeSharpening()` implements Eq. 7, S(x) = (1+p)*blur1(x) - p*blur2(x). In
 * any roughly flat neighborhood blur1(x) ≈ blur2(x) ≈ that neighborhood's local
 * brightness, so S(x) itself sits near the local tone there -- it's not centered
 * on some fixed midpoint. `applyThreshold()` (via `ThresholdModes.soft`) then does
 * `value >= epsilon -> white, else soft-thresholded toward black`. A flat epsilon
 * tuned for midtones will sit *below* S(x) everywhere in a bright region (crushing
 * it to white with no edges surviving) and *above* S(x) everywhere in a dark one
 * (crushing it to black). For epsilon to threshold something meaningful in both
 * places, it has to move with local tone the same way S(x) does: lower in dark
 * neighborhoods, higher in light ones. That's the ordering this module defaults to.
 *
 * This mirrors the paper's own fix for an analogous problem in ADoG -- Eq. (5)
 * makes the contrast-sensitivity parameter rho(x) a tanh-shaped function of local
 * tone I(x) instead of a constant. Here we apply the same shape to epsilon: rather
 * than reading raw per-pixel intensity (noisy), we blur the input first to get a
 * smooth "local area brightness" reading, then interpolate between a dark-region
 * epsilon and a light-region epsilon using that same tanh curve.
 *
 * The result is a ChannelImage the same size as the input, suitable for wrapping
 * with `ScalarField.fromChannelImage()` and passing as the `epsilon` override to
 * any of the DoG implementations (see usage examples at the bottom).
 */
import { IsotropicBlur } from '../../blur/isotropic.js';
import { createChannelImage } from '../../utils/image.js';
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
export async function toneAdaptiveEstimate(input, options) {
    const { epsilonDark, epsilonLight, localitySigma = 8, s = 2 } = options;
    const blurStrategy = options.blurStrategy ?? (await IsotropicBlur.create({ kernelSizeMultiplier: 4 }));
    const ownsBlurStrategy = !options.blurStrategy;
    try {
        const localTone = await blurStrategy.blur(input, localitySigma);
        const epsilon = createChannelImage(input.width, input.height);
        for (let i = 0; i < epsilon.data.length; i++) {
            const w = Math.tanh(s * localTone.data[i]); // 0 (dark) -> ~1 (light)
            epsilon.data[i] = epsilonDark + (epsilonLight - epsilonDark) * w;
        }
        return epsilon;
    }
    finally {
        if (ownsBlurStrategy)
            blurStrategy.dispose();
    }
}
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
export async function localBaselineEstimate(input, options) {
    const { sigma, offset = 0 } = options;
    const blurStrategy = options.blurStrategy ?? (await IsotropicBlur.create({ kernelSizeMultiplier: 4 }));
    const ownsBlurStrategy = !options.blurStrategy;
    try {
        const baseline = await blurStrategy.blur(input, sigma);
        const epsilon = createChannelImage(input.width, input.height);
        for (let i = 0; i < epsilon.data.length; i++) {
            epsilon.data[i] = baseline.data[i] + offset;
        }
        return epsilon;
    }
    finally {
        if (ownsBlurStrategy)
            blurStrategy.dispose();
    }
}
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
//# sourceMappingURL=epsilon.js.map