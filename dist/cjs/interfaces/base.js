"use strict";
/**
 * Core types for XDoG/FDoG/ADoG/HDoG line drawing implementation
 *
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 * and: "Gaussian Image Binarization" by Kang & Stamoulis (2021)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_ETF_CONFIG = exports.DEFAULT_GAUSSIAN_CONFIG = exports.DEFAULT_QUANTIZER_CONFIG = exports.DEFAULT_CONTRAST_ENHANCEMENT_CONFIG = exports.DEFAULT_KUWAHARA_CONFIG = exports.DEFAULT_MEDIAN_CONFIG = exports.DEFAULT_BILATERAL_CONFIG = exports.DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG = exports.DEFAULT_ISOTROPIC_BLUR_CONFIG = void 0;
exports.DEFAULT_ISOTROPIC_BLUR_CONFIG = {
    sigma: 1,
    kernelSizeMultiplier: 6,
    maxKernelSize: 63,
};
exports.DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG = {
    kernelSizeMultiplier: 6,
    stepSize: 1.0,
};
// Default config values (mirrors the CPU implementation in cpu.ts)
exports.DEFAULT_BILATERAL_CONFIG = {
    sigmaSpatial: 3,
    sigmaRange: 0.1,
    radiusMultiplier: 2,
};
exports.DEFAULT_MEDIAN_CONFIG = {
    radius: 2,
};
exports.DEFAULT_KUWAHARA_CONFIG = {
    radius: 3,
};
exports.DEFAULT_CONTRAST_ENHANCEMENT_CONFIG = {
    blackPoint: 0.01,
    whitePoint: 0.99
};
exports.DEFAULT_QUANTIZER_CONFIG = {
    levels: 8
};
exports.DEFAULT_GAUSSIAN_CONFIG = {
    sigma: 1.0
};
/**
 * Default ETF configuration values
 */
exports.DEFAULT_ETF_CONFIG = {
    iterations: 3,
    kernelSize: 5,
};
//# sourceMappingURL=base.js.map