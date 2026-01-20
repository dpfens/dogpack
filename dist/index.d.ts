/**
 * XDoG/FDoG Line Drawing Library
 *
 * A TypeScript implementation of Extended Difference-of-Gaussians (XDoG)
 * and Flow-based Difference-of-Gaussians (FDoG) for artistic line drawing
 * and edge stylization.
 *
 * @example Basic XDoG usage
 * ```typescript
 * import { XDoG } from 'xdog';
 *
 * const xdog = new XDoG({ sigma: 1.0, phi: 10 });
 * const result = xdog.processImageData(canvasImageData);
 * ctx.putImageData(result, 0, 0);
 * ```
 *
 * @example FDoG for coherent line drawing
 * ```typescript
 * import { FDoG } from 'xdog';
 *
 * const fdog = new FDoG({ sigma: 1.0, etfIterations: 3 });
 * const result = fdog.processImageData(canvasImageData);
 * ctx.putImageData(result, 0, 0);
 * ```
 *
 * @example Custom blur strategy
 * ```typescript
 * import { DoGProcessor, IsotropicBlur } from 'xdog';
 *
 * const blur = new IsotropicBlur({ kernelSizeMultiplier: 8 });
 * const processor = new DoGProcessor(blur, { sigma: 2.0, phi: 5 });
 * const result = processor.process(grayscaleImage);
 * ```
 */
export { XDoG, FDoG } from './xdog.js';
export type { XDoGConfig, FDoGConfig } from './xdog.js';
export { DoGProcessor, ThresholdModes } from './dog.js';
export { IsotropicBlur, FlowGuidedBlur } from './blur.js';
export type { BlurStrategy, BlurStrategyClass, IsotropicBlurConfig } from './blur.js';
export { WebGLIsotropicBlur, WebGLFlowGuidedBlur } from './blur-webgl.js';
export type { WebGLBlurConfig } from './blur-webgl.js';
export { WebGPUIsotropicBlur, WebGPUFlowGuidedBlur } from './blur-webgpu.js';
export type { WebGPUBlurConfig } from './blur-webgpu.js';
export { EdgeTangentFlow } from './etf.js';
export { PreprocessingPresets, Preprocessor } from './preprocess.js';
export type { Vec2, GrayscaleImage, RGBImage, FlowField, DoGConfig, ETFConfig, } from './types.js';
export { DEFAULT_DOG_CONFIG, DEFAULT_ETF_CONFIG } from './types.js';
export { createGrayscaleImage, cloneGrayscaleImage, imageDataToGrayscale, grayscaleToImageData, rgbToGrayscale, getPixel, setPixel, } from './utils.js';
//# sourceMappingURL=index.d.ts.map