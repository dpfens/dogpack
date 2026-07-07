import { HardThresholdStrategy, SoftThresholdStrategy } from '../threshold.js';
/**
 * Default DoG configuration values
 * Based on paper's recommendations and Appendix A parameter ranges
 */
export const DEFAULT_DOG_CONFIG = {
    sigma: 1.0,
    k: 1.6,
    p: 20.0, // Strong edge emphasis suitable for most styles
    epsilon: 0.5, // Mid-tone threshold (normalized 0-1)
    phi: 10.0, // Moderately sharp 
    thresholdStrategy: new SoftThresholdStrategy()
};
/**
 * Default FDoG configuration values
 * Based on Table A.1 in the paper
 */
export const DEFAULT_FDOG_CONFIG = {
    ...DEFAULT_DOG_CONFIG,
    sigmaC: 2.5, // Structure tensor smoothing
    sigmaM: 4.0, // Flow-aligned smoothing  
    sigmaA: 1.0, // Anti-aliasing
};
/**
 * Default ADoG configuration values
 * Based on Section 3.2 of "Gaussian Image Binarization"
 * (σc = 1.0, σs = 1.6σc, τ = 0.99, s = 2.0, noise c = 0.01)
 */
export const DEFAULT_ADOG_CONFIG = {
    ...DEFAULT_DOG_CONFIG,
    sigma: 1.0,
    k: 1.6,
    tau: 0.99,
    s: 2.0,
    noiseScaleC: 0.01,
    kernelSizeMultiplier: 6,
    epsilon: 0.05,
    phi: 200,
    thresholdStrategy: new HardThresholdStrategy(),
};
/**
 * Default HDoG configuration values
 * s' defaults to 4s per the paper's empirical setting (Eq. 9)
 */
export const DEFAULT_HDOG_CONFIG = {
    fdog: {},
    adog: {},
    adogSecondaryScaleFactor: 4,
};
/**
 * Preset configurations for common styles from the paper
 */
export const STYLE_PRESETS = {
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
export const FDOG_STYLE_PRESETS = {
    /**
     * Standard FDoG for coherent line drawing (Figure 2g)
     */
    standard: {
        ...STYLE_PRESETS.threshold,
        sigmaC: 2.28,
        sigmaM: 4.4,
        sigmaA: 1.0,
    },
    /**
     * Pastel with flow (Figure 18b)
     */
    pastel: {
        ...STYLE_PRESETS.pastel,
        sigmaC: 0.1, // Minimal structure tensor smoothing
        sigmaM: 20, // Large flow smoothing for turbulence
        sigmaA: 7.2,
    },
    /**
     * Woodcut with aggressive flow (Figure 15)
     */
    woodcut: {
        ...STYLE_PRESETS.woodcut,
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
export const ADOG_STYLE_PRESETS = {
    standard: {
        ...DEFAULT_ADOG_CONFIG,
    },
};
//# sourceMappingURL=types.js.map