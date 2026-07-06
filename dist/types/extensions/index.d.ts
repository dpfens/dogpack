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
export type { DoGResult, ExtensionStrategy } from './base';
export { AntiAliasingStrategy } from './anti-alias';
export type { AntiAliasingConfig } from './anti-alias';
export * as colorRetention from './color-retention';
export type { Color, ColorRetentionConfig, ColorTransformFn, MaskTransformFn, PostProcessFn } from './color-retention';
export { HatchingStrategy } from './hatching';
export type { HatchTexture, HatchingConfig } from './hatching';
export { NaturalMediaStrategy } from './natural-media';
export type { NaturalMediaConfig, NaturalMediaStyle } from './natural-media';
export * as multiScale from './multi-scale';
export type { BlendContext, BlendFunction, BuiltinBlendMode, MultiScaleConfig, MultiScaleLayer } from './multi-scale';
export { imageDataToRGB, rgbToImageData, grayscaleToRGB } from './utils';
//# sourceMappingURL=index.d.ts.map