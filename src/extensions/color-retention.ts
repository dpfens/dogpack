/**
 * Color Retention Extension - Extensible Architecture
 * 
 * Provides a composable, hook-based system for combining stylized XDoG/FDoG
 * output with original colors. Developers can inject custom logic at every
 * stage of the pipeline.
 * 
 * Pipeline stages:
 * 1. Mask Transform: Modify the stylized mask before blending
 * 2. Color Transform: Pre-process the original color
 * 3. Blend Function: Combine mask and color (the core operation)
 * 4. Post-Process: Final adjustments to the output
 * 
 * Based on Section 5.2 of the XDoG paper.
 */

import type { ChannelImage } from '../core/types';
import type { RGBImage } from './base'

// =============================================================================
// Core Types
// =============================================================================

/**
 * RGBA color tuple (values in 0-1 range)
 */
export type Color = [r: number, g: number, b: number];

/**
 * Pixel context provided to all hook functions
 * Contains spatial and neighborhood information for advanced effects
 */
export interface PixelContext {
  /** Current pixel x coordinate */
  x: number;
  /** Current pixel y coordinate */
  y: number;
  /** Linear index into the image array */
  index: number;
  /** Image width */
  width: number;
  /** Image height */
  height: number;
  /** Normalized x coordinate (0-1) */
  u: number;
  /** Normalized v coordinate (0-1) */
  v: number;
  
  /**
   * Sample the original color at an offset from current pixel
   * Useful for blur, sharpen, or texture effects
   */
  sampleColor: (dx: number, dy: number) => Color;
  
  /**
   * Sample the mask at an offset from current pixel
   */
  sampleMask: (dx: number, dy: number) => number;
  
  /**
   * Get a value from the shared state (for multi-pass effects)
   */
  getState: <T>(key: string) => T | undefined;
  
  /**
   * Set a value in the shared state
   */
  setState: <T>(key: string, value: T) => void;
}

// =============================================================================
// Hook Function Types
// =============================================================================

/**
 * Transform the stylized mask value before blending
 * 
 * @param mask - Original mask value (0 = edge, 1 = background)
 * @param ctx - Pixel context with spatial info and sampling functions
 * @returns Transformed mask value
 * 
 * @example
 * ```typescript
 * // Increase edge thickness by expanding dark regions
 * const thickenEdges: MaskTransformFn = (mask, ctx) => {
 *   // Sample neighbors and take minimum (expand dark)
 *   let min = mask;
 *   for (let dy = -1; dy <= 1; dy++) {
 *     for (let dx = -1; dx <= 1; dx++) {
 *       min = Math.min(min, ctx.sampleMask(dx, dy));
 *     }
 *   }
 *   return min;
 * };
 * ```
 */
export type MaskTransformFn = (mask: number, ctx: PixelContext) => number;

/**
 * Transform the original color before blending
 * 
 * @param color - Original RGB color
 * @param mask - Current mask value (after mask transform)
 * @param ctx - Pixel context
 * @returns Transformed color
 * 
 * @example
 * ```typescript
 * // Boost saturation in non-edge areas
 * const boostSaturation: ColorTransformFn = (color, mask, ctx) => {
 *   const [h, s, l] = rgbToHsl(...color);
 *   const boostedS = s * (1 + 0.3 * mask); // More saturation where mask is light
 *   return hslToRgb(h, Math.min(1, boostedS), l);
 * };
 * ```
 */
export type ColorTransformFn = (color: Color, mask: number, ctx: PixelContext) => Color;

/**
 * Core blend function that combines mask and color
 * 
 * @param color - Transformed color
 * @param mask - Transformed mask value
 * @param ctx - Pixel context
 * @returns Blended output color
 * 
 * @example
 * ```typescript
 * // Simple multiply blend
 * const multiply: BlendFn = (color, mask) => {
 *   return [color[0] * mask, color[1] * mask, color[2] * mask];
 * };
 * 
 * // Screen blend for lighter result
 * const screen: BlendFn = (color, mask) => {
 *   return [
 *     1 - (1 - color[0]) * (1 - mask),
 *     1 - (1 - color[1]) * (1 - mask),
 *     1 - (1 - color[2]) * (1 - mask),
 *   ];
 * };
 * ```
 */
export type BlendFn = (color: Color, mask: number, ctx: PixelContext) => Color;

/**
 * Post-process the blended result
 * 
 * @param color - Blended color
 * @param originalColor - Original input color (for reference)
 * @param mask - Final mask value
 * @param ctx - Pixel context
 * @returns Final output color
 * 
 * @example
 * ```typescript
 * // Add vignette effect
 * const vignette: PostProcessFn = (color, original, mask, ctx) => {
 *   const dist = Math.sqrt((ctx.u - 0.5) ** 2 + (ctx.v - 0.5) ** 2);
 *   const vignette = 1 - Math.min(1, dist * 1.2);
 *   return [color[0] * vignette, color[1] * vignette, color[2] * vignette];
 * };
 * ```
 */
export type PostProcessFn = (
  color: Color,
  originalColor: Color,
  mask: number,
  ctx: PixelContext
) => Color;

/**
 * Global pre-processing hook (runs once before pixel iteration)
 * Useful for computing histograms, statistics, or initializing state
 */
export type PreProcessHook = (
  stylized: ChannelImage,
  originalColor: RGBImage,
  state: Map<string, unknown>
) => void;

/**
 * Global post-processing hook (runs once after pixel iteration)
 * Useful for normalization, filtering, or multi-pass effects
 */
export type GlobalPostProcessHook = (
  output: RGBImage,
  state: Map<string, unknown>
) => RGBImage;

// =============================================================================
// Configuration
// =============================================================================

/**
 * Full configuration for the color retention pipeline
 */
export interface ColorRetentionConfig {
  /**
   * Mask transformation function
   * Default: identity (no change)
   */
  maskTransform?: MaskTransformFn;
  
  /**
   * Color transformation function
   * Default: identity (no change)
   */
  colorTransform?: ColorTransformFn;
  
  /**
   * Core blend function (required or use preset)
   */
  blend: BlendFn;
  
  /**
   * Post-processing function
   * Default: identity (no change)
   */
  postProcess?: PostProcessFn;
  
  /**
   * Global pre-processing hook
   */
  preProcess?: PreProcessHook;
  
  /**
   * Global post-processing hook
   */
  globalPostProcess?: GlobalPostProcessHook;
  
  /**
   * Chain multiple mask transforms (applied in order)
   */
  maskTransformChain?: MaskTransformFn[];
  
  /**
   * Chain multiple color transforms (applied in order)
   */
  colorTransformChain?: ColorTransformFn[];
  
  /**
   * Chain multiple post-process functions (applied in order)
   */
  postProcessChain?: PostProcessFn[];
}

// =============================================================================
// Main Strategy Class
// =============================================================================

/**
 * Extensible Color Retention Strategy
 * 
 * A fully customizable pipeline for combining stylized edges with colors.
 * Every stage can be overridden with custom functions.
 * 
 * @example Basic usage with preset
 * ```typescript
 * const strategy = ColorRetentionStrategy.preset('coloredEdges');
 * const result = await strategy.apply({ stylized, originalColor });
 * ```
 * 
 * @example Custom blend function
 * ```typescript
 * const strategy = new ColorRetentionStrategy({
 *   blend: (color, mask) => {
 *     // Custom logic here
 *     return [color[0] * mask, color[1] * mask, color[2] * mask];
 *   }
 * });
 * ```
 * 
 * @example Full pipeline customization
 * ```typescript
 * const strategy = new ColorRetentionStrategy({
 *   maskTransform: (mask) => Math.pow(mask, 0.8), // Gamma adjust
 *   colorTransform: (color, mask) => boostSaturation(color, 1.2),
 *   blend: BlendFunctions.multiply,
 *   postProcess: (color, orig, mask, ctx) => addVignette(color, ctx),
 * });
 * ```
 * 
 * @example Chaining multiple transforms
 * ```typescript
 * const strategy = new ColorRetentionStrategy({
 *   maskTransformChain: [
 *     MaskTransforms.gamma(0.8),
 *     MaskTransforms.threshold(0.1, 0.9),
 *   ],
 *   colorTransformChain: [
 *     ColorTransforms.saturation(1.2),
 *     ColorTransforms.brightness(0.1),
 *   ],
 *   blend: BlendFunctions.coloredEdges(),
 * });
 * ```
 */
export class ColorRetentionStrategy {
  private config: ColorRetentionConfig;
  
  constructor(config: ColorRetentionConfig) {
    this.config = config;
  }
  
  async apply(
    input: { stylized: ChannelImage; originalColor: RGBImage },
    configOverride?: Partial<ColorRetentionConfig>
  ): Promise<RGBImage> {
    const cfg = { ...this.config, ...configOverride };
    const { stylized, originalColor } = input;
    const { width, height } = stylized;
    const size = width * height;
    
    // Shared state for hooks
    const state = new Map<string, unknown>();
    
    // Run global pre-process
    if (cfg.preProcess) {
      cfg.preProcess(stylized, originalColor, state);
    }
    
    // Build transform chains
    const maskTransforms = this.buildMaskTransformChain(cfg);
    const colorTransforms = this.buildColorTransformChain(cfg);
    const postProcesses = this.buildPostProcessChain(cfg);
    
    // Create output
    const output: RGBImage = {
      r: new Float32Array(size),
      g: new Float32Array(size),
      b: new Float32Array(size),
      width,
      height,
    };
    
    // Process each pixel
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        
        // Build pixel context
        const ctx = this.createPixelContext(
          x, y, index, width, height,
          stylized, originalColor, state
        );
        
        // Get initial values
        let mask = stylized.data[index];
        let color: Color = [
          originalColor.r[index],
          originalColor.g[index],
          originalColor.b[index],
        ];
        const origColor: Color = [...color];
        
        // Apply mask transforms
        for (const transform of maskTransforms) {
          mask = transform(mask, ctx);
        }
        
        // Apply color transforms
        for (const transform of colorTransforms) {
          color = transform(color, mask, ctx);
        }
        
        // Apply blend
        let result = cfg.blend(color, mask, ctx);
        
        // Apply post-processes
        for (const postProcess of postProcesses) {
          result = postProcess(result, origColor, mask, ctx);
        }
        
        // Write output
        output.r[index] = clamp(result[0]);
        output.g[index] = clamp(result[1]);
        output.b[index] = clamp(result[2]);
      }
    }
    
    // Run global post-process
    if (cfg.globalPostProcess) {
      return cfg.globalPostProcess(output, state);
    }
    
    return output;
  }
  
  private buildMaskTransformChain(cfg: ColorRetentionConfig): MaskTransformFn[] {
    const chain: MaskTransformFn[] = [];
    if (cfg.maskTransform) chain.push(cfg.maskTransform);
    if (cfg.maskTransformChain) chain.push(...cfg.maskTransformChain);
    return chain;
  }
  
  private buildColorTransformChain(cfg: ColorRetentionConfig): ColorTransformFn[] {
    const chain: ColorTransformFn[] = [];
    if (cfg.colorTransform) chain.push(cfg.colorTransform);
    if (cfg.colorTransformChain) chain.push(...cfg.colorTransformChain);
    return chain;
  }
  
  private buildPostProcessChain(cfg: ColorRetentionConfig): PostProcessFn[] {
    const chain: PostProcessFn[] = [];
    if (cfg.postProcess) chain.push(cfg.postProcess);
    if (cfg.postProcessChain) chain.push(...cfg.postProcessChain);
    return chain;
  }
  
  private createPixelContext(
    x: number,
    y: number,
    index: number,
    width: number,
    height: number,
    stylized: ChannelImage,
    originalColor: RGBImage,
    state: Map<string, unknown>
  ): PixelContext {
    return {
      x,
      y,
      index,
      width,
      height,
      u: x / (width - 1),
      v: y / (height - 1),
      
      sampleColor: (dx: number, dy: number): Color => {
        const sx = clampInt(x + dx, 0, width - 1);
        const sy = clampInt(y + dy, 0, height - 1);
        const si = sy * width + sx;
        return [originalColor.r[si], originalColor.g[si], originalColor.b[si]];
      },
      
      sampleMask: (dx: number, dy: number): number => {
        const sx = clampInt(x + dx, 0, width - 1);
        const sy = clampInt(y + dy, 0, height - 1);
        return stylized.data[sy * width + sx];
      },
      
      getState: <T>(key: string): T | undefined => state.get(key) as T | undefined,
      setState: <T>(key: string, value: T): void => { state.set(key, value); },
    };
  }
  
  // ===========================================================================
  // Static Factory Methods
  // ===========================================================================
  
  /**
   * Create a strategy from a preset
   */
  static preset(name: keyof typeof Presets): ColorRetentionStrategy {
    return new ColorRetentionStrategy(Presets[name]);
  }
  
  /**
   * Create a strategy with just a blend function
   */
  static withBlend(blend: BlendFn): ColorRetentionStrategy {
    return new ColorRetentionStrategy({ blend });
  }
  
  /**
   * Builder pattern for constructing complex pipelines
   */
  static builder(): ColorRetentionBuilder {
    return new ColorRetentionBuilder();
  }
}

// =============================================================================
// Builder Pattern
// =============================================================================

/**
 * Fluent builder for constructing color retention pipelines
 * 
 * @example
 * ```typescript
 * const strategy = ColorRetentionStrategy.builder()
 *   .maskTransform(MaskTransforms.gamma(0.8))
 *   .maskTransform(MaskTransforms.clamp(0.05, 0.95))
 *   .colorTransform(ColorTransforms.saturation(1.2))
 *   .blend(BlendFunctions.multiply)
 *   .postProcess(PostProcessors.vignette(0.3))
 *   .build();
 * ```
 */
export class ColorRetentionBuilder {
  private maskTransforms: MaskTransformFn[] = [];
  private colorTransforms: ColorTransformFn[] = [];
  private postProcesses: PostProcessFn[] = [];
  private blendFn?: BlendFn;
  private preProcessHook?: PreProcessHook;
  private globalPostProcessHook?: GlobalPostProcessHook;
  
  maskTransform(fn: MaskTransformFn): this {
    this.maskTransforms.push(fn);
    return this;
  }
  
  colorTransform(fn: ColorTransformFn): this {
    this.colorTransforms.push(fn);
    return this;
  }
  
  blend(fn: BlendFn): this {
    this.blendFn = fn;
    return this;
  }
  
  postProcess(fn: PostProcessFn): this {
    this.postProcesses.push(fn);
    return this;
  }
  
  preProcess(fn: PreProcessHook): this {
    this.preProcessHook = fn;
    return this;
  }
  
  globalPostProcess(fn: GlobalPostProcessHook): this {
    this.globalPostProcessHook = fn;
    return this;
  }
  
  build(): ColorRetentionStrategy {
    if (!this.blendFn) {
      throw new Error('Blend function is required. Call .blend() before .build()');
    }
    
    return new ColorRetentionStrategy({
      blend: this.blendFn,
      maskTransformChain: this.maskTransforms.length > 0 ? this.maskTransforms : undefined,
      colorTransformChain: this.colorTransforms.length > 0 ? this.colorTransforms : undefined,
      postProcessChain: this.postProcesses.length > 0 ? this.postProcesses : undefined,
      preProcess: this.preProcessHook,
      globalPostProcess: this.globalPostProcessHook,
    });
  }
}

// =============================================================================
// Built-in Blend Functions
// =============================================================================

/**
 * Collection of common blend functions
 */
export const BlendFunctions = {
  /**
   * Simple multiply: color * mask
   * White mask = full color, black mask = black
   */
  multiply: ((color, mask) => [
    color[0] * mask,
    color[1] * mask,
    color[2] * mask,
  ]) as BlendFn,
  
  /**
   * Screen blend: 1 - (1-color) * (1-mask)
   * Creates lighter results
   */
  screen: ((color, mask) => [
    1 - (1 - color[0]) * (1 - mask),
    1 - (1 - color[1]) * (1 - mask),
    1 - (1 - color[2]) * (1 - mask),
  ]) as BlendFn,
  
  /**
   * Overlay blend: combines multiply and screen
   */
  overlay: ((color, mask) => {
    const overlay = (c: number, m: number) =>
      c < 0.5 ? 2 * c * m : 1 - 2 * (1 - c) * (1 - m);
    return [overlay(color[0], mask), overlay(color[1], mask), overlay(color[2], mask)];
  }) as BlendFn,
  
  /**
   * Soft light blend: gentler than overlay
   */
  softLight: ((color, mask) => {
    const soft = (c: number, m: number) => {
      if (m < 0.5) {
        return c - (1 - 2 * m) * c * (1 - c);
      }
      const d = c <= 0.25 ? ((16 * c - 12) * c + 4) * c : Math.sqrt(c);
      return c + (2 * m - 1) * (d - c);
    };
    return [soft(color[0], mask), soft(color[1], mask), soft(color[2], mask)];
  }) as BlendFn,
  
  /**
   * Colored edges: black lines on colored background
   * Most common use case for line art + color
   */
  coloredEdges: (edgeStrength: number = 1.0): BlendFn => {
    const edgeBrightness = 1 - edgeStrength;
    return (color, mask) => [
      color[0] * mask + edgeBrightness * (1 - mask),
      color[1] * mask + edgeBrightness * (1 - mask),
      color[2] * mask + edgeBrightness * (1 - mask),
    ];
  },
  
  /**
   * Tinted lines: edges take on underlying color
   */
  tintedLines: (darkness: number = 0.8): BlendFn => {
    const minBrightness = 1 - darkness;
    return (color, mask) => {
      const edgeR = color[0] * minBrightness;
      const edgeG = color[1] * minBrightness;
      const edgeB = color[2] * minBrightness;
      return [
        edgeR + (color[0] - edgeR) * mask,
        edgeG + (color[1] - edgeG) * mask,
        edgeB + (color[2] - edgeB) * mask,
      ];
    };
  },
  
  /**
   * Luminosity replacement in HSL space
   */
  luminosity: ((color, mask) => {
    const [h, s] = rgbToHsl(...color);
    return hslToRgb(h, s, mask);
  }) as BlendFn,
  
  /**
   * Linear interpolation between color and grayscale edge
   */
  lerp: (edgeColor: Color = [0, 0, 0]): BlendFn => {
    return (color, mask) => [
      edgeColor[0] + (color[0] - edgeColor[0]) * mask,
      edgeColor[1] + (color[1] - edgeColor[1]) * mask,
      edgeColor[2] + (color[2] - edgeColor[2]) * mask,
    ];
  },
  
  /**
   * Preserve hue and saturation, replace value (HSV)
   */
  valueReplace: ((color, mask) => {
    const [h, s] = rgbToHsv(...color);
    return hsvToRgb(h, s, mask);
  }) as BlendFn,
};

// =============================================================================
// Built-in Mask Transforms
// =============================================================================

/**
 * Collection of mask transformation functions
 */
export const MaskTransforms = {
  /**
   * Gamma correction for mask
   */
  gamma: (gamma: number): MaskTransformFn => 
    (mask) => Math.pow(mask, gamma),
  
  /**
   * Clamp mask to range
   */
  clamp: (min: number, max: number): MaskTransformFn =>
    (mask) => Math.max(min, Math.min(max, mask)),
  
  /**
   * Remap mask from [inMin, inMax] to [outMin, outMax]
   */
  remap: (inMin: number, inMax: number, outMin: number = 0, outMax: number = 1): MaskTransformFn =>
    (mask) => outMin + (outMax - outMin) * ((mask - inMin) / (inMax - inMin)),
  
  /**
   * Invert the mask
   */
  invert: (): MaskTransformFn => (mask) => 1 - mask,
  
  /**
   * Apply contrast adjustment
   */
  contrast: (amount: number): MaskTransformFn =>
    (mask) => clamp((mask - 0.5) * amount + 0.5),
  
  /**
   * Threshold with soft edges
   */
  softThreshold: (threshold: number, softness: number = 0.1): MaskTransformFn =>
    (mask) => clamp((mask - threshold + softness) / (2 * softness)),
  
  /**
   * Hard threshold (binary)
   */
  threshold: (threshold: number): MaskTransformFn =>
    (mask) => mask > threshold ? 1 : 0,
  
  /**
   * Quantize to N levels
   */
  quantize: (levels: number): MaskTransformFn =>
    (mask) => Math.round(mask * (levels - 1)) / (levels - 1),
  
  /**
   * Morphological dilation (expand dark/edge regions)
   */
  dilate: (radius: number = 1): MaskTransformFn =>
    (mask, ctx) => {
      let min = mask;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy <= radius * radius) {
            min = Math.min(min, ctx.sampleMask(dx, dy));
          }
        }
      }
      return min;
    },
  
  /**
   * Morphological erosion (shrink dark/edge regions)
   */
  erode: (radius: number = 1): MaskTransformFn =>
    (mask, ctx) => {
      let max = mask;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy <= radius * radius) {
            max = Math.max(max, ctx.sampleMask(dx, dy));
          }
        }
      }
      return max;
    },
  
  /**
   * Gaussian blur approximation
   */
  blur: (radius: number = 1): MaskTransformFn =>
    (_mask, ctx) => {
      let sum = 0;
      let weight = 0;
      const sigma = radius / 2;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const w = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
          sum += ctx.sampleMask(dx, dy) * w;
          weight += w;
        }
      }
      return sum / weight;
    },
    
  /**
   * Add noise to mask
   */
  noise: (amount: number, seed: number = 12345): MaskTransformFn => {
    // Simple deterministic hash for reproducibility
    const hash = (x: number, y: number) => {
      let h = seed + x * 374761393 + y * 668265263;
      h = (h ^ (h >> 13)) * 1274126177;
      return ((h ^ (h >> 16)) & 0xFFFF) / 0xFFFF;
    };
    return (mask, ctx) => clamp(mask + (hash(ctx.x, ctx.y) - 0.5) * amount * 2);
  },
};

// =============================================================================
// Built-in Color Transforms
// =============================================================================

/**
 * Collection of color transformation functions
 */
export const ColorTransforms = {
  /**
   * Adjust saturation
   */
  saturation: (factor: number): ColorTransformFn =>
    (color) => {
      const [h, s, l] = rgbToHsl(...color);
      return hslToRgb(h, clamp(s * factor), l);
    },
  
  /**
   * Adjust brightness
   */
  brightness: (amount: number): ColorTransformFn =>
    (color) => {
      if (amount > 0) {
        return [
          color[0] + (1 - color[0]) * amount,
          color[1] + (1 - color[1]) * amount,
          color[2] + (1 - color[2]) * amount,
        ];
      }
      return [
        color[0] * (1 + amount),
        color[1] * (1 + amount),
        color[2] * (1 + amount),
      ];
    },
  
  /**
   * Adjust contrast
   */
  contrast: (amount: number): ColorTransformFn =>
    (color) => [
      clamp((color[0] - 0.5) * amount + 0.5),
      clamp((color[1] - 0.5) * amount + 0.5),
      clamp((color[2] - 0.5) * amount + 0.5),
    ],
  
  /**
   * Shift hue
   */
  hueShift: (degrees: number): ColorTransformFn =>
    (color) => {
      const [h, s, l] = rgbToHsl(...color);
      return hslToRgb((h + degrees / 360 + 1) % 1, s, l);
    },
  
  /**
   * Desaturate based on mask (less saturation in edge areas)
   */
  maskBasedDesaturate: (factor: number = 0.5): ColorTransformFn =>
    (color, mask) => {
      const [h, s, l] = rgbToHsl(...color);
      const newS = s * (mask + (1 - mask) * (1 - factor));
      return hslToRgb(h, newS, l);
    },
  
  /**
   * Apply a color matrix transformation
   */
  colorMatrix: (matrix: number[][]): ColorTransformFn =>
    (color) => {
      const [r, g, b] = color;
      return [
        clamp(matrix[0][0] * r + matrix[0][1] * g + matrix[0][2] * b + (matrix[0][3] || 0)),
        clamp(matrix[1][0] * r + matrix[1][1] * g + matrix[1][2] * b + (matrix[1][3] || 0)),
        clamp(matrix[2][0] * r + matrix[2][1] * g + matrix[2][2] * b + (matrix[2][3] || 0)),
      ];
    },
  
  /**
   * Sepia tone
   */
  sepia: (intensity: number = 1.0): ColorTransformFn => {
    const matrix = [
      [0.393, 0.769, 0.189],
      [0.349, 0.686, 0.168],
      [0.272, 0.534, 0.131],
    ];
    return (color) => {
      const [r, g, b] = color;
      const sepiaR = clamp(matrix[0][0] * r + matrix[0][1] * g + matrix[0][2] * b);
      const sepiaG = clamp(matrix[1][0] * r + matrix[1][1] * g + matrix[1][2] * b);
      const sepiaB = clamp(matrix[2][0] * r + matrix[2][1] * g + matrix[2][2] * b);
      return [
        r + (sepiaR - r) * intensity,
        g + (sepiaG - g) * intensity,
        b + (sepiaB - b) * intensity,
      ];
    };
  },
  
  /**
   * Warm/cool temperature adjustment
   */
  temperature: (warmth: number): ColorTransformFn =>
    (color) => {
      // Positive = warmer (more red/yellow), negative = cooler (more blue)
      return [
        clamp(color[0] + warmth * 0.1),
        color[1],
        clamp(color[2] - warmth * 0.1),
      ];
    },
};

// =============================================================================
// Built-in Post Processors
// =============================================================================

/**
 * Collection of post-processing functions
 */
export const PostProcessors = {
  /**
   * Add vignette effect
   */
  vignette: (strength: number = 0.3, radius: number = 0.7): PostProcessFn =>
    (color, _orig, _mask, ctx) => {
      const dist = Math.sqrt((ctx.u - 0.5) ** 2 + (ctx.v - 0.5) ** 2) / 0.707;
      const vignette = 1 - Math.max(0, (dist - radius) / (1 - radius)) * strength;
      return [color[0] * vignette, color[1] * vignette, color[2] * vignette];
    },
  
  /**
   * Add film grain
   */
  grain: (amount: number = 0.05, seed: number = 54321): PostProcessFn => {
    const hash = (x: number, y: number) => {
      let h = seed + x * 374761393 + y * 668265263;
      h = (h ^ (h >> 13)) * 1274126177;
      return ((h ^ (h >> 16)) & 0xFFFF) / 0xFFFF;
    };
    return (color, _orig, _mask, ctx) => {
      const noise = (hash(ctx.x, ctx.y) - 0.5) * amount * 2;
      return [
        clamp(color[0] + noise),
        clamp(color[1] + noise),
        clamp(color[2] + noise),
      ];
    };
  },
  
  /**
   * Blend with original color
   */
  blendOriginal: (amount: number): PostProcessFn =>
    (color, orig) => [
      color[0] + (orig[0] - color[0]) * amount,
      color[1] + (orig[1] - color[1]) * amount,
      color[2] + (orig[2] - color[2]) * amount,
    ],
  
  /**
   * Clamp output to valid range
   */
  clampOutput: (): PostProcessFn =>
    (color) => [clamp(color[0]), clamp(color[1]), clamp(color[2])],
  
  /**
   * Posterize (reduce color levels)
   */
  posterize: (levels: number): PostProcessFn =>
    (color) => [
      Math.round(color[0] * (levels - 1)) / (levels - 1),
      Math.round(color[1] * (levels - 1)) / (levels - 1),
      Math.round(color[2] * (levels - 1)) / (levels - 1),
    ],
    
  /**
   * Edge-aware sharpening
   */
  sharpenEdges: (amount: number = 0.5): PostProcessFn =>
    (color, orig, mask) => {
      // Sharpen more in edge areas (where mask is darker)
      const sharpness = amount * (1 - mask);
      return [
        clamp(color[0] + (color[0] - orig[0]) * sharpness),
        clamp(color[1] + (color[1] - orig[1]) * sharpness),
        clamp(color[2] + (color[2] - orig[2]) * sharpness),
      ];
    },
};

// =============================================================================
// Presets
// =============================================================================

/**
 * Pre-built configurations for common use cases
 */
export const Presets: Record<string, ColorRetentionConfig> = {
  /**
   * Standard: black lines on full-color background
   */
  coloredEdges: {
    blend: BlendFunctions.coloredEdges(1.0),
  },
  
  /**
   * Painterly: soft, integrated tinted edges
   */
  painterly: {
    maskTransformChain: [MaskTransforms.gamma(0.85)],
    colorTransformChain: [ColorTransforms.saturation(1.1)],
    blend: BlendFunctions.tintedLines(0.7),
    postProcessChain: [PostProcessors.vignette(0.15)],
  },
  
  /**
   * Vintage: muted colors with soft grain
   */
  vintage: {
    maskTransformChain: [MaskTransforms.contrast(0.9)],
    colorTransformChain: [
      ColorTransforms.saturation(0.7),
      ColorTransforms.sepia(0.3),
    ],
    blend: BlendFunctions.softLight,
    postProcessChain: [PostProcessors.grain(0.03)],
  },
  
  /**
   * Bold: high contrast with boosted saturation
   */
  bold: {
    maskTransformChain: [MaskTransforms.contrast(1.3)],
    colorTransformChain: [
      ColorTransforms.saturation(1.3),
      ColorTransforms.contrast(1.1),
    ],
    blend: BlendFunctions.coloredEdges(1.0),
  },
  
  /**
   * Sketch: pure line art with optional paper texture
   */
  sketch: {
    maskTransformChain: [
      MaskTransforms.threshold(0.5),
    ],
    blend: BlendFunctions.multiply,
  },
  
  /**
   * Watercolor: soft edges with color bleeding effect
   */
  watercolor: {
    maskTransformChain: [
      MaskTransforms.blur(2),
      MaskTransforms.gamma(0.7),
    ],
    colorTransformChain: [
      ColorTransforms.saturation(1.2),
    ],
    blend: BlendFunctions.tintedLines(0.5),
    postProcessChain: [PostProcessors.vignette(0.2)],
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

function clamp(value: number, min: number = 0, max: number = 1): number {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

// HSL conversion
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  
  if (max === min) return [0, 0, l];
  
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  
  let h: number;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    default: h = ((r - g) / d + 4) / 6; break;
  }
  
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  
  const hue2rgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  
  return [hue2rgb(h + 1/3), hue2rgb(h), hue2rgb(h - 1/3)];
}

// HSV conversion
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  
  if (max === min) return [0, s, v];
  
  let h: number;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    default: h = ((r - g) / d + 4) / 6; break;
  }
  
  return [h, s, v];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

// =============================================================================
// Utility Functions for Image Conversion
// =============================================================================

export function imageDataToRGB(imageData: ImageData): RGBImage {
  const { width, height } = imageData;
  const size = width * height;
  
  const rgb: RGBImage = {
    r: new Float32Array(size),
    g: new Float32Array(size),
    b: new Float32Array(size),
    width,
    height,
  };
  
  for (let i = 0; i < size; i++) {
    rgb.r[i] = imageData.data[i * 4] / 255;
    rgb.g[i] = imageData.data[i * 4 + 1] / 255;
    rgb.b[i] = imageData.data[i * 4 + 2] / 255;
  }
  
  return rgb;
}

export function rgbToImageData(rgb: RGBImage): ImageData {
  const { width, height } = rgb;
  const imageData = new ImageData(width, height);
  const size = width * height;
  
  for (let i = 0; i < size; i++) {
    imageData.data[i * 4] = Math.round(clamp(rgb.r[i]) * 255);
    imageData.data[i * 4 + 1] = Math.round(clamp(rgb.g[i]) * 255);
    imageData.data[i * 4 + 2] = Math.round(clamp(rgb.b[i]) * 255);
    imageData.data[i * 4 + 3] = 255;
  }
  
  return imageData;
}