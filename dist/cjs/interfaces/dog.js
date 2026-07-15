"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HDOG_STYLE_PRESETS = exports.ADOG_STYLE_PRESETS = exports.FDOG_STYLE_PRESETS = exports.STYLE_PRESETS = exports.DEFAULT_HDOG_CONFIG = exports.DEFAULT_ADOG_CONFIG = exports.DEFAULT_FDOG_CONFIG = exports.DEFAULT_DOG_CONFIG = exports.HDOG_PARAM_RANGES = exports.ADOG_PARAM_RANGES = exports.FDOG_PARAM_RANGES = exports.XDOG_PARAM_RANGES = exports.DOG_PARAM_RANGES = void 0;
const threshold_js_1 = require("../threshold.js");
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
exports.DOG_PARAM_RANGES = {
    sigma: { hardMin: 0, hardMax: Infinity, recommendedMin: 0.4, recommendedMax: 7.0, default: 1.0, step: 0.1 },
    k: { hardMin: 1.0, hardMax: Infinity, recommendedMin: 1.4, recommendedMax: 1.6, default: 1.6, step: 0.01 },
    p: { hardMin: 0, hardMax: Infinity, recommendedMin: 0, recommendedMax: 120, default: 20, step: 1 },
    epsilon: { hardMin: 0, hardMax: 1, recommendedMin: 0.5, recommendedMax: 1.0, default: 0.5, step: 0.01 },
    phi: { hardMin: 0, hardMax: Infinity, recommendedMin: 0.01, recommendedMax: 200, default: 10, step: 0.5 },
};
/**
 * XDoG-specific parameter ranges (on top of DOG_PARAM_RANGES).
 *
 * kernelSizeMultiplier is the Gaussian truncation radius as a multiple of
 * σ. Winnemöller samples the Gaussian out to ~2σ for the DoG passes
 * (Appendix A/B), but a wider window (≈6σ) captures the tail more fully;
 * 3σ covers ~99.7% and is the practical floor for a clean kernel.
 */
exports.XDOG_PARAM_RANGES = {
    ...exports.DOG_PARAM_RANGES,
    kernelSizeMultiplier: { hardMin: 1, hardMax: Infinity, recommendedMin: 3, recommendedMax: 8, default: 6, step: 1 },
};
exports.FDOG_PARAM_RANGES = {
    ...exports.DOG_PARAM_RANGES,
    sigmaC: { hardMin: 0, hardMax: Infinity, recommendedMin: 0.1, recommendedMax: 6.0, default: 2.5, step: 0.1 },
    sigmaM: { hardMin: 0, hardMax: Infinity, recommendedMin: 3.0, recommendedMax: 20.0, default: 4.0, step: 0.5 },
    sigmaA: { hardMin: 0, hardMax: Infinity, recommendedMin: 0.5, recommendedMax: 7.2, default: 1.0, step: 0.1 },
};
exports.ADOG_PARAM_RANGES = {
    ...exports.DOG_PARAM_RANGES,
    kernelSizeMultiplier: exports.XDOG_PARAM_RANGES.kernelSizeMultiplier,
    k: { hardMin: 1.0, hardMax: Infinity, recommendedMin: 1.6, recommendedMax: 1.6, default: 1.6, step: 0.01 },
    epsilon: { hardMin: 0, hardMax: 1, recommendedMin: 0.0, recommendedMax: 0.2, default: 0.05, step: 0.01 },
    phi: { hardMin: 0, hardMax: Infinity, recommendedMin: 100, recommendedMax: 200, default: 200, step: 5 },
    tau: { hardMin: 0, hardMax: 1, recommendedMin: 0.97, recommendedMax: 1.0, default: 0.99, step: 0.005 },
    s: { hardMin: 0, hardMax: Infinity, recommendedMin: 0.5, recommendedMax: 5.0, default: 2.0, step: 0.1 },
    noiseScaleC: { hardMin: 0, hardMax: Infinity, recommendedMin: 0, recommendedMax: 0.05, default: 0.01, step: 0.005 },
};
/** HDoG shares ADoG's parameter regime (its screentone passes are ADoG). */
exports.HDOG_PARAM_RANGES = {
    ...exports.ADOG_PARAM_RANGES,
    adogSecondaryScaleFactor: { hardMin: 1.0, hardMax: Infinity, recommendedMin: 2.0, recommendedMax: 6.0, default: 4.0, step: 0.25 },
};
/**
 * Default DoG configuration values
 * Based on paper's recommendations and Appendix A parameter ranges
 */
exports.DEFAULT_DOG_CONFIG = {
    sigma: exports.DOG_PARAM_RANGES.sigma.default,
    k: exports.DOG_PARAM_RANGES.k.default,
    p: exports.DOG_PARAM_RANGES.p.default, // Strong edge emphasis suitable for most styles
    epsilon: exports.DOG_PARAM_RANGES.epsilon.default, // Mid-tone threshold (normalized 0-1)
    phi: exports.DOG_PARAM_RANGES.phi.default, // Moderately sharp 
    thresholdStrategy: new threshold_js_1.SoftThresholdStrategy()
};
/**
 * Default FDoG configuration values
 * Based on Table A.1 in the paper
 */
exports.DEFAULT_FDOG_CONFIG = {
    ...exports.DEFAULT_DOG_CONFIG,
    sigmaC: exports.FDOG_PARAM_RANGES.sigmaC.default, // Structure tensor smoothing
    sigmaM: exports.FDOG_PARAM_RANGES.sigmaM.default, // Flow-aligned smoothing
    sigmaA: exports.FDOG_PARAM_RANGES.sigmaA.default, // Anti-aliasing
};
/**
 * Default ADoG configuration values
 * Based on Section 3.2 of "Gaussian Image Binarization"
 * (σc = 1.0, σs = 1.6σc, τ = 0.99, s = 2.0, noise c = 0.01)
 */
exports.DEFAULT_ADOG_CONFIG = {
    ...exports.DEFAULT_DOG_CONFIG,
    sigma: exports.ADOG_PARAM_RANGES.sigma.default,
    k: exports.ADOG_PARAM_RANGES.k.default,
    epsilon: exports.ADOG_PARAM_RANGES.epsilon.default, // Low: dark screentone primitives on white
    phi: exports.ADOG_PARAM_RANGES.phi.default, // High: hard-threshold / near step function
    tau: exports.ADOG_PARAM_RANGES.tau.default,
    s: exports.ADOG_PARAM_RANGES.s.default,
    noiseScaleC: exports.ADOG_PARAM_RANGES.noiseScaleC.default,
    kernelSizeMultiplier: exports.XDOG_PARAM_RANGES.kernelSizeMultiplier.default,
    thresholdStrategy: new threshold_js_1.HardThresholdStrategy(),
};
/**
 * Default HDoG configuration values
 * s' defaults to 4s per the paper's empirical setting (Eq. 9)
 */
exports.DEFAULT_HDOG_CONFIG = {
    fdog: {},
    adog: {},
    adogSecondaryScaleFactor: 4,
};
/**
 * Preset configurations for common styles from the paper
 */
exports.STYLE_PRESETS = {
    /**
     * Pencil shading style (Figure 1b, Section 5.2)
     * High-frequency detail resembling graphite on paper
     */
    pencilShading: {
        sigma: 0.4,
        k: 1.6,
        p: 20,
        epsilon: 0.5,
        phi: 0.01, // Very soft threshold for gradual tones
    },
    /**
     * Pastel style (Figure 18b, Section 5.2)
     * Intermediate edge width with flow turbulence
     */
    pastel: {
        sigma: 2.0,
        k: 1.6,
        p: 40,
        epsilon: 1.0, // High threshold (mostly white)
        phi: 0.01,
    },
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
    },
    /**
     * Thresholding / line art (Section 4.1)
     * Clean black and white edges
     */
    threshold: {
        sigma: 1.4,
        k: 1.6,
        p: 20,
        epsilon: 0.78,
        phi: 100, // Very sharp threshold (near step function)
    },
    /**
     * Woodcut style (Section 4.2, Figure 15)
     * Aggressive flow distortion with extreme edge emphasis
     */
    woodcut: {
        sigma: 0.8,
        k: 1.6,
        p: 120, // Extreme edge emphasis
        epsilon: 0.73,
        phi: 100, // Hard threshold
    },
};
/**
 * Preset FDoG configurations including flow parameters
 */
exports.FDOG_STYLE_PRESETS = {
    /**
     * Standard FDoG for coherent line drawing (Figure 2g)
     */
    standard: {
        ...exports.STYLE_PRESETS.threshold,
        sigmaC: 2.28,
        sigmaM: 4.4,
        sigmaA: 1.0,
    },
    /**
     * Pastel with flow (Figure 18b)
     */
    pastel: {
        ...exports.STYLE_PRESETS.pastel,
        sigmaC: 0.1, // Minimal structure tensor smoothing
        sigmaM: 20, // Large flow smoothing for turbulence
        sigmaA: 7.2,
    },
    /**
     * Woodcut with aggressive flow (Figure 15)
     */
    woodcut: {
        ...exports.STYLE_PRESETS.woodcut,
        sigmaC: 5.84,
        sigmaM: 3.2,
        sigmaA: 0.75,
    },
};
/**
 * Preset ADoG configurations
 * (No presets given directly in the paper's tables beyond the defaults
 * above; add named presets here as you tune them, e.g. denser/lighter
 * screentone variants.)
 */
exports.ADOG_STYLE_PRESETS = {
    standard: {
        ...exports.DEFAULT_ADOG_CONFIG,
    },
};
exports.HDOG_STYLE_PRESETS = {
    /**
     * Paper defaults (Sec. 3.1–3.3): σc=1.0, k=1.6 (σs=1.6σc), σm=3.0,
     * σa≈1.0 (not explicitly stated as a default in the paper's FDoG
     * section, so this uses a light anti-aliasing value), τ=0.99, s=2.0,
     * noiseScaleC=0.01, s'=4s. This is the closest match to Figs. 13–14.
     */
    default: {
        fdog: exports.DEFAULT_FDOG_CONFIG,
        adog: exports.DEFAULT_ADOG_CONFIG,
        adogSecondaryScaleFactor: 4,
    }
};
//# sourceMappingURL=dog.js.map