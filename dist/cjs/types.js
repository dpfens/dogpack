"use strict";
/**
 * Core types for XDoG/FDoG/ADoG/HDoG line drawing implementation
 *
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 * and: "Gaussian Image Binarization" by Kang & Stamoulis (2021)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_ETF_CONFIG = exports.DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG = void 0;
exports.DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG = {
    kernelSizeMultiplier: 6,
    stepSize: 1.0,
};
/**
 * Default ETF configuration values
 */
exports.DEFAULT_ETF_CONFIG = {
    iterations: 3,
    kernelSize: 5,
};
//# sourceMappingURL=types.js.map