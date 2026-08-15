/**
 * Core types for XDoG/FDoG/ADoG/HDoG line drawing implementation
 *
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 * and: "Gaussian Image Binarization" by Kang & Stamoulis (2021)
 */
export const DEFAULT_ISOTROPIC_BLUR_CONFIG = {
    sigma: 1,
    kernelSizeMultiplier: 6,
    maxKernelSize: 63,
};
export const DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG = {
    kernelSizeMultiplier: 6,
    stepSize: 1.0,
};
// Default config values (mirrors the CPU implementation in cpu.ts)
export const DEFAULT_BILATERAL_CONFIG = {
    sigmaSpatial: 3,
    sigmaRange: 0.1,
    radiusMultiplier: 2,
};
export const DEFAULT_MEDIAN_CONFIG = {
    radius: 2,
};
export const DEFAULT_KUWAHARA_CONFIG = {
    radius: 3,
};
export const DEFAULT_CONTRAST_ENHANCEMENT_CONFIG = {
    blackPoint: 0.01,
    whitePoint: 0.99
};
export const DEFAULT_QUANTIZER_CONFIG = {
    levels: 8
};
export const DEFAULT_GAUSSIAN_CONFIG = {
    sigma: 1.0
};
/**
 * Default ETF configuration values
 */
export const DEFAULT_ETF_CONFIG = {
    iterations: 3,
    kernelSize: 5,
};
//# sourceMappingURL=base.js.map