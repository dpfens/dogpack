"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADOG_STYLE_PRESETS = exports.FDOG_STYLE_PRESETS = exports.STYLE_PRESETS = exports.DEFAULT_HDOG_CONFIG = exports.DEFAULT_ADOG_CONFIG = exports.DEFAULT_FDOG_CONFIG = exports.DEFAULT_DOG_CONFIG = void 0;
const threshold_js_1 = require("../threshold.js");
/**
 * Default DoG configuration values
 * Based on paper's recommendations and Appendix A parameter ranges
 */
exports.DEFAULT_DOG_CONFIG = {
    sigma: 1.0,
    k: 1.6,
    p: 20.0, // Strong edge emphasis suitable for most styles
    epsilon: 0.5, // Mid-tone threshold (normalized 0-1)
    phi: 10.0, // Moderately sharp 
    thresholdStrategy: new threshold_js_1.SoftThresholdStrategy()
};
/**
 * Default FDoG configuration values
 * Based on Table A.1 in the paper
 */
exports.DEFAULT_FDOG_CONFIG = {
    ...exports.DEFAULT_DOG_CONFIG,
    sigmaC: 2.5, // Structure tensor smoothing
    sigmaM: 4.0, // Flow-aligned smoothing  
    sigmaA: 1.0, // Anti-aliasing
};
/**
 * Default ADoG configuration values
 * Based on Section 3.2 of "Gaussian Image Binarization"
 * (σc = 1.0, σs = 1.6σc, τ = 0.99, s = 2.0, noise c = 0.01)
 */
exports.DEFAULT_ADOG_CONFIG = {
    ...exports.DEFAULT_DOG_CONFIG,
    sigma: 1.0, // σc
    k: 1.6, // σs = k * σc
    tau: 0.99,
    s: 2.0,
    noiseScaleC: 0.01,
    kernelSizeMultiplier: 6,
    thresholdStrategy: new threshold_js_1.HardThresholdStrategy(), // ADoG binarizes; hard threshold matches the paper's step-function output
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
//# sourceMappingURL=types.js.map