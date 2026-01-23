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
export { AntiAliasingStrategy } from './anti-alias.js';
export { ColorRetentionBuilder, ColorRetentionStrategy, ColorTransforms, MaskTransforms, Presets, PostProcessors, BlendFunctions } from './color-retention.js';
export { HatchingStrategy } from './hatching.js';
export { NaturalMediaStrategy } from './natural-media.js';
export { createGammaCorrectedBlend, createMixedBlend, createPercentileBlend, MultiScaleStrategy, BlendFunctions as ScaleBlendFunctions } from './multi-scale.js';
export { imageDataToRGB, rgbToImageData, grayscaleToRGB } from './utils.js';
//# sourceMappingURL=index.js.map