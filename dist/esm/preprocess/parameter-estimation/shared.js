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
import { createChannelImage } from '../../utils/index.js';
import { IsotropicBlur } from '../../blur/isotropic.js';
async function resolveBlur(provided) {
    if (provided)
        return { blur: provided, owns: false };
    return { blur: await IsotropicBlur.create({ kernelSizeMultiplier: 4 }), owns: true };
}
/** value(x) = low + (high - low) * tanh(s * localTone(x)) */
export async function toneAdaptiveEstimate(input, options) {
    const { low, high, localitySigma = 8, s = 2 } = options;
    const { blur, owns } = await resolveBlur(options.blurStrategy);
    try {
        const localTone = await blur.blur(input, localitySigma);
        const output = createChannelImage(input.width, input.height);
        for (let i = 0; i < output.data.length; i++) {
            output.data[i] = low + (high - low) * Math.tanh(s * localTone.data[i]);
        }
        return output;
    }
    finally {
        if (owns)
            blur.dispose();
    }
}
/** Convenience: derive low/high from a center + spread instead of picking both by hand. */
export async function toneAdaptiveEstimateAuto(input, options) {
    const { center, spread, higherInLight = true, ...rest } = options;
    const low = higherInLight ? center - spread : center + spread;
    const high = higherInLight ? center + spread : center - spread;
    return toneAdaptiveEstimate(input, { ...rest, low, high });
}
/** value(x) = blur(input, sigma)(x) + offset [+ contrastMargin * localStdDev(x)] */
export async function localBaselineEstimate(input, options) {
    const { sigma, offset = 0, contrastMargin = 0 } = options;
    const { blur, owns } = await resolveBlur(options.blurStrategy);
    try {
        const baseline = await blur.blur(input, sigma);
        const output = createChannelImage(input.width, input.height);
        if (contrastMargin > 0) {
            const squared = createChannelImage(input.width, input.height);
            for (let i = 0; i < input.data.length; i++)
                squared.data[i] = input.data[i] * input.data[i];
            const meanSquared = await blur.blur(squared, sigma);
            for (let i = 0; i < output.data.length; i++) {
                const variance = Math.max(0, meanSquared.data[i] - baseline.data[i] ** 2);
                output.data[i] = baseline.data[i] + offset + contrastMargin * Math.sqrt(variance);
            }
        }
        else {
            for (let i = 0; i < output.data.length; i++) {
                output.data[i] = baseline.data[i] + offset;
            }
        }
        return output;
    }
    finally {
        if (owns)
            blur.dispose();
    }
}
function normalizeToUnit(field, gamma) {
    let max = 0;
    for (let i = 0; i < field.data.length; i++)
        if (field.data[i] > max)
            max = field.data[i];
    const output = createChannelImage(field.width, field.height);
    if (max <= 0)
        return output;
    for (let i = 0; i < output.data.length; i++) {
        const n = field.data[i] / max;
        output.data[i] = gamma === 1 ? n : Math.pow(n, gamma);
    }
    return output;
}
function gradientMagnitude(input) {
    const { width, height, data } = input;
    const output = createChannelImage(width, height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const xm = Math.max(x - 1, 0), xp = Math.min(x + 1, width - 1);
            const ym = Math.max(y - 1, 0), yp = Math.min(y + 1, height - 1);
            const ix = (data[y * width + xp] - data[y * width + xm]) / (xp - xm || 1);
            const iy = (data[yp * width + x] - data[ym * width + x]) / (yp - ym || 1);
            output.data[y * width + x] = Math.sqrt(ix * ix + iy * iy);
        }
    }
    return output;
}
/** value(x) = low + (high - low) * normalizedGradientMagnitude(x)^gamma */
export async function magnitudeAdaptiveEstimate(input, options) {
    const { low, high, smoothingSigma = 1, gamma = 1 } = options;
    let magnitude = gradientMagnitude(input);
    if (smoothingSigma > 0) {
        const { blur, owns } = await resolveBlur(options.blurStrategy);
        try {
            magnitude = await blur.blur(magnitude, smoothingSigma);
        }
        finally {
            if (owns)
                blur.dispose();
        }
    }
    const normalized = normalizeToUnit(magnitude, gamma);
    const output = createChannelImage(input.width, input.height);
    for (let i = 0; i < output.data.length; i++) {
        output.data[i] = low + (high - low) * normalized.data[i];
    }
    return output;
}
/** value(x) = low + (high - low) * normalizedLocalVariance(x)^gamma */
export async function varianceAdaptiveEstimate(input, options) {
    const { low, high, sigma, gamma = 1 } = options;
    const { blur, owns } = await resolveBlur(options.blurStrategy);
    try {
        const baseline = await blur.blur(input, sigma);
        const squared = createChannelImage(input.width, input.height);
        for (let i = 0; i < input.data.length; i++)
            squared.data[i] = input.data[i] * input.data[i];
        const meanSquared = await blur.blur(squared, sigma);
        const variance = createChannelImage(input.width, input.height);
        for (let i = 0; i < variance.data.length; i++) {
            variance.data[i] = Math.max(0, meanSquared.data[i] - baseline.data[i] ** 2);
        }
        const normalized = normalizeToUnit(variance, gamma);
        const output = createChannelImage(input.width, input.height);
        for (let i = 0; i < output.data.length; i++) {
            output.data[i] = low + (high - low) * normalized.data[i];
        }
        return output;
    }
    finally {
        if (owns)
            blur.dispose();
    }
}
//# sourceMappingURL=shared.js.map