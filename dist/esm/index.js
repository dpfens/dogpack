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
export * as dog from './dog';
// Core processor (for advanced usage)
export { DoGProcessor, ThresholdModes, applyCustomThreshold } from './processor';
// Blur strategies (for custom configurations)
export * as blur from './blur';
// Edge Tangent Flow (for visualization or custom pipelines)
export { EdgeTangentFlow } from './etf';
// Preprocessing
export * as preprocess from './preprocess';
export * as threshold from './threshold';
export { DEFAULT_ETF_CONFIG } from './types';
// Utilities
export * as utilities from './utils';
// Extensions (composable strategies for advanced stylization)
export * as extensions from './extensions';
//# sourceMappingURL=index.js.map