"use strict";
/**
 * XDoG/FDoG Line Drawing Library
 *
 * A TypeScript implementation of Extended Difference-of-Gaussians (XDoG)
 * and Flow-based Difference-of-Gaussians (FDoG) for artistic line drawing
 * and edge stylization.
 *
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 *
 * Key differences from a naive implementation:
 *
 * 1. Uses the reparameterized sharpening formulation (Equation 7):
 *    S_σ,k,p(x) = (1 + p) · G_σ(x) - p · G_kσ(x)
 *    This decouples edge sharpening strength from threshold parameters.
 *
 * 2. FDoG uses three separate sigma parameters:
 *    - σc: Structure tensor smoothing
 *    - σe: Edge detection (gradient-aligned DoG)
 *    - σm: Flow-aligned smoothing
 *
 * 3. Includes anti-aliasing pass (σa) for FDoG
 *
 * 4. Structure tensor is smoothed with Gaussian (not box filter)
 *
 * @example Basic XDoG usage
 * ```typescript
 * import { XDoG } from 'xdog';
 *
 * const xdog = new XDoG({ sigma: 1.0, p: 20, phi: 10 });
 * const result = await xdog.processImageData(canvasImageData);
 * ctx.putImageData(result, 0, 0);
 * ```
 *
 * @example Using a style preset
 * ```typescript
 * import { XDoG, STYLE_PRESETS } from 'xdog';
 *
 * // Use pencil shading preset
 * const xdog = new XDoG(STYLE_PRESETS.pencilShading);
 *
 * // Or use the static factory method
 * const xdog2 = XDoG.withPreset('threshold');
 * ```
 *
 * @example FDoG for coherent line drawing
 * ```typescript
 * import { FDoG } from 'xdog';
 *
 * const fdog = new FDoG({
 *   sigma: 1.4,      // Edge detection sigma (σe)
 *   sigmaC: 2.5,     // Structure tensor smoothing (σc)
 *   sigmaM: 4.0,     // Flow-aligned smoothing (σm)
 *   sigmaA: 1.0,     // Anti-aliasing (σa)
 *   p: 20,
 *   phi: 10
 * });
 * const result = await fdog.processImageData(canvasImageData);
 * ```
 *
 * @example Custom blur strategy
 * ```typescript
 * import { DoGProcessor, IsotropicBlur } from 'xdog';
 *
 * const blur = new IsotropicBlur({ kernelSizeMultiplier: 8 });
 * const processor = new DoGProcessor(blur, { sigma: 2.0, p: 30, phi: 5 });
 * const result = await processor.process(grayscaleImage);
 * ```
 *
 * @example With preprocessing for noisy images
 * ```typescript
 * import { XDoG, Preprocessor, imageDataToLuminance, grayscaleToImageData } from 'xdog';
 *
 * const preprocessor = new Preprocessor()
 *   .bilateral({ sigmaSpatial: 4, sigmaRange: 0.1 });
 *
 * const gray = imageDataToLuminance(imageData);
 * const cleaned = preprocessor.apply(gray);
 *
 * const xdog = new XDoG({ p: 20, phi: 100 });
 * const result = await xdog.process(cleaned);
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extensions = exports.utilities = exports.FDOG_STYLE_PRESETS = exports.STYLE_PRESETS = exports.DEFAULT_FDOG_CONFIG = exports.DEFAULT_ETF_CONFIG = exports.DEFAULT_DOG_CONFIG = exports.threshold = exports.preprocess = exports.EdgeTangentFlow = exports.blur = exports.applyCustomThreshold = exports.ThresholdModes = exports.DoGProcessor = exports.fdog = exports.xdog = exports.FDoG = exports.XDoG = exports.core = void 0;
// High-level API
exports.core = require("./core");
var dog_1 = require("./core/dog");
Object.defineProperty(exports, "XDoG", { enumerable: true, get: function () { return dog_1.XDoG; } });
Object.defineProperty(exports, "FDoG", { enumerable: true, get: function () { return dog_1.FDoG; } });
Object.defineProperty(exports, "xdog", { enumerable: true, get: function () { return dog_1.xdog; } });
Object.defineProperty(exports, "fdog", { enumerable: true, get: function () { return dog_1.fdog; } });
// Core processor (for advanced usage)
var processor_1 = require("./core/processor");
Object.defineProperty(exports, "DoGProcessor", { enumerable: true, get: function () { return processor_1.DoGProcessor; } });
Object.defineProperty(exports, "ThresholdModes", { enumerable: true, get: function () { return processor_1.ThresholdModes; } });
Object.defineProperty(exports, "applyCustomThreshold", { enumerable: true, get: function () { return processor_1.applyCustomThreshold; } });
// Blur strategies (for custom configurations)
exports.blur = require("./blur");
// Edge Tangent Flow (for visualization or custom pipelines)
var etf_1 = require("./etf");
Object.defineProperty(exports, "EdgeTangentFlow", { enumerable: true, get: function () { return etf_1.EdgeTangentFlow; } });
// Preprocessing
exports.preprocess = require("./preprocess");
exports.threshold = require("./core/threshold");
var types_1 = require("./core/types");
Object.defineProperty(exports, "DEFAULT_DOG_CONFIG", { enumerable: true, get: function () { return types_1.DEFAULT_DOG_CONFIG; } });
Object.defineProperty(exports, "DEFAULT_ETF_CONFIG", { enumerable: true, get: function () { return types_1.DEFAULT_ETF_CONFIG; } });
Object.defineProperty(exports, "DEFAULT_FDOG_CONFIG", { enumerable: true, get: function () { return types_1.DEFAULT_FDOG_CONFIG; } });
Object.defineProperty(exports, "STYLE_PRESETS", { enumerable: true, get: function () { return types_1.STYLE_PRESETS; } });
Object.defineProperty(exports, "FDOG_STYLE_PRESETS", { enumerable: true, get: function () { return types_1.FDOG_STYLE_PRESETS; } });
// Utilities
exports.utilities = require("./utils");
// Extensions (composable strategies for advanced stylization)
exports.extensions = require("./extensions");
//# sourceMappingURL=index.js.map