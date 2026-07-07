"use strict";
/**
 * XDoG/FDoG Extensions Module
 *
 * Provides composable strategy patterns for extending XDoG/FDoG output:
 * - Hatching: Multiple threshold masks for tonal art maps
 * - Natural Media: Pencil, pastel, charcoal effects via parameter tuning
 * - Anti-aliasing: LIC pass along edge tangent flow
 * - Color Retention: Modulating stylized output with source colors
 * - Multi-scale: Combining results at different σ values
 *
 * Based on Sections 4.3, 5.1, 5.2 of:
 * "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 *
 * Design Philosophy:
 * - Each extension is a standalone strategy that can be composed
 * - Developers control XDoG vs FDoG choice and parameters
 * - Extensions accept pre-processed results or raw images
 * - Chainable pipeline architecture
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.grayscaleToRGB = exports.rgbToImageData = exports.imageDataToRGB = exports.multiScale = exports.NaturalMediaStrategy = exports.HatchingStrategy = exports.colorRetention = exports.AntiAliasingStrategy = void 0;
var anti_alias_js_1 = require("./anti-alias.js");
Object.defineProperty(exports, "AntiAliasingStrategy", { enumerable: true, get: function () { return anti_alias_js_1.AntiAliasingStrategy; } });
exports.colorRetention = require("./color-retention.js");
var hatching_js_1 = require("./hatching.js");
Object.defineProperty(exports, "HatchingStrategy", { enumerable: true, get: function () { return hatching_js_1.HatchingStrategy; } });
var natural_media_js_1 = require("./natural-media.js");
Object.defineProperty(exports, "NaturalMediaStrategy", { enumerable: true, get: function () { return natural_media_js_1.NaturalMediaStrategy; } });
exports.multiScale = require("./multi-scale.js");
var utils_js_1 = require("./utils.js");
Object.defineProperty(exports, "imageDataToRGB", { enumerable: true, get: function () { return utils_js_1.imageDataToRGB; } });
Object.defineProperty(exports, "rgbToImageData", { enumerable: true, get: function () { return utils_js_1.rgbToImageData; } });
Object.defineProperty(exports, "grayscaleToRGB", { enumerable: true, get: function () { return utils_js_1.grayscaleToRGB; } });
//# sourceMappingURL=index.js.map