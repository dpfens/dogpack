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

import { 
  GrayscaleImage, 
  FDoGConfig,
  FlowField,
} from './types.js';
import { 
  createGrayscaleImage, 
  getPixel, 
  getPixelBilinear,
} from './utils.js';
import { XDoG, FDoG } from './xdog.js';
import { EdgeTangentFlow } from './etf/index.js';
import { FlowGuidedBlur } from './blur/index.js';

// =============================================================================
// Core Types
// =============================================================================

/**
 * Base interface for all extension strategies
 */
export interface ExtensionStrategy<TConfig, TInput, TOutput> {
  apply(input: TInput, config?: Partial<TConfig>): Promise<TOutput>;
}

/**
 * RGB image representation for color operations
 */
export interface RGBImage {
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  width: number;
  height: number;
}

/**
 * Result from a DoG processor (either XDoG or FDoG)
 */
export interface DoGResult {
  /** The final processed image */
  image: GrayscaleImage;
  /** The sharpened image before thresholding (if available) */
  sharpened?: GrayscaleImage;
  /** Edge tangent flow (only from FDoG) */
  etf?: EdgeTangentFlow;
  /** The original grayscale input */
  originalGray?: GrayscaleImage;
  /** The original color input (if provided) */
  originalColor?: RGBImage;
}

// =============================================================================
// Anti-Aliasing Extension (Section 4.3)
// =============================================================================

/**
 * Anti-aliasing configuration
 * 
 * From Section 4.3: "Since many of the examples in this paper use the ETF 
 * field to compute coherent edges, we can easily re-use the ETF to apply 
 * a very small line integral convolution along the field"
 */
export interface AntiAliasingConfig {
  /** 
   * Integration sigma along the flow direction (default: 1.0)
   * - 0.5-2 pixels: Standard anti-aliasing
   * - >2: Stylistic smoothing effect
   */
  sigma: number;
  
  /**
   * Step size for LIC sampling (default: 0.5)
   */
  stepSize: number;
}

const DEFAULT_AA_CONFIG: AntiAliasingConfig = {
  sigma: 1.0,
  stepSize: 0.5,
};

/**
 * Anti-Aliasing Strategy
 * 
 * Applies line integral convolution along the edge tangent flow
 * to produce image-coherent and visually pleasing anti-aliasing.
 * 
 * @example
 * ```typescript
 * const fdog = new FDoG({ ... });
 * const result = await fdog.processDetailed(input);
 * 
 * const aa = new AntiAliasingStrategy();
 * const smoothed = await aa.apply({
 *   image: result.result,
 *   etf: result.etf
 * }, { sigma: 1.5 });
 * ```
 */
export class AntiAliasingStrategy implements ExtensionStrategy<
  AntiAliasingConfig,
  { image: GrayscaleImage; etf: FlowField },
  GrayscaleImage
> {
  private config: AntiAliasingConfig;
  
  constructor(config: Partial<AntiAliasingConfig> = {}) {
    this.config = { ...DEFAULT_AA_CONFIG, ...config };
  }
  
  async apply(
    input: { image: GrayscaleImage; etf: FlowField },
    configOverride?: Partial<AntiAliasingConfig>
  ): Promise<GrayscaleImage> {
    const cfg = { ...this.config, ...configOverride };
    const { image, etf } = input;
    
    if (cfg.sigma <= 0) {
      return { data: new Float32Array(image.data), width: image.width, height: image.height };
    }
    
    const flowBlur = new FlowGuidedBlur(etf, { stepSize: cfg.stepSize });
    return flowBlur.blur(image, cfg.sigma);
  }
  
  /**
   * Create anti-aliasing with preset intensity
   */
  static withPreset(preset: 'subtle' | 'standard' | 'stylistic'): AntiAliasingStrategy {
    const presets: Record<string, AntiAliasingConfig> = {
      subtle: { sigma: 0.5, stepSize: 0.5 },
      standard: { sigma: 1.0, stepSize: 0.5 },
      stylistic: { sigma: 3.0, stepSize: 0.5 },
    };
    return new AntiAliasingStrategy(presets[preset]);
  }
}

// =============================================================================
// Hatching Extension (Section 5.1)
// =============================================================================

/**
 * Hatching texture specification
 */
export interface HatchTexture {
  /** Grayscale texture data (tiled as needed) */
  data: GrayscaleImage;
  /** Rotation angle in radians (0 = horizontal) */
  rotation: number;
}

/**
 * Hatching configuration
 * 
 * From Section 5.1: "Our hatching approach is based on the concept of 
 * tonal art maps, where layers of strokes add up to achieve a desired tone"
 */
export interface HatchingConfig {
  /**
   * Threshold levels for creating masks (ascending order)
   * Each level creates a separate tone band
   * Default: [0.3, 0.5, 0.7] creates 4 bands
   */
  thresholdLevels: number[];
  
  /**
   * Hatching textures for each band (darkest to lightest)
   * Should have length = thresholdLevels.length + 1
   */
  textures?: HatchTexture[];
  
  /**
   * Background/paper texture (optional)
   */
  paperTexture?: GrayscaleImage;
  
  /**
   * Sharpening strength for threshold masks (default: 20)
   */
  p: number;
  
  /**
   * Threshold sharpness - high values for crisp hatching masks (default: 100)
   */
  phi: number;
}

const DEFAULT_HATCHING_CONFIG: HatchingConfig = {
  thresholdLevels: [0.3, 0.5, 0.7],
  p: 20,
  phi: 100,
};

/**
 * Hatching Strategy
 * 
 * Creates tonal art maps by computing multiple threshold levels from a
 * sharpened XDoG/FDoG image and using them as masks for hatching textures.
 * 
 * @example
 * ```typescript
 * const xdog = new XDoG({ p: 20 });
 * const sharpened = await xdog.processSharpened(input);
 * 
 * const hatching = new HatchingStrategy({
 *   thresholdLevels: [0.25, 0.5, 0.75],
 *   textures: [darkHatch, medHatch, lightHatch, white],
 * });
 * const result = await hatching.apply({ sharpened, original: input });
 * ```
 */
export class HatchingStrategy implements ExtensionStrategy<
  HatchingConfig,
  { sharpened: GrayscaleImage; original?: GrayscaleImage },
  GrayscaleImage
> {
  private config: HatchingConfig;
  
  constructor(config: Partial<HatchingConfig> = {}) {
    this.config = { ...DEFAULT_HATCHING_CONFIG, ...config };
  }
  
  /**
   * Generate threshold masks for each tone band
   */
  generateMasks(
    sharpened: GrayscaleImage,
    configOverride?: Partial<HatchingConfig>
  ): GrayscaleImage[] {
    const cfg = { ...this.config, ...configOverride };
    const { width, height } = sharpened;
    const levels = [...cfg.thresholdLevels].sort((a, b) => a - b);
    
    // Create masks for each band
    // Band 0: below first threshold (darkest)
    // Band n: above last threshold (lightest)
    const masks: GrayscaleImage[] = [];
    
    for (let i = 0; i <= levels.length; i++) {
      const mask = createGrayscaleImage(width, height);
      
      for (let j = 0; j < width * height; j++) {
        const val = sharpened.data[j];
        
        let inBand: boolean;
        if (i === 0) {
          // Darkest band: below first threshold
          inBand = val < levels[0];
        } else if (i === levels.length) {
          // Lightest band: above last threshold
          inBand = val >= levels[i - 1];
        } else {
          // Middle bands
          inBand = val >= levels[i - 1] && val < levels[i];
        }
        
        // Apply soft thresholding for smoother transitions
        if (inBand) {
          mask.data[j] = 1.0;
        } else {
          // Smooth falloff near boundaries
          let dist = Infinity;
          if (i === 0) {
            dist = levels[0] - val;
          } else if (i === levels.length) {
            dist = val - levels[i - 1];
          } else {
            dist = Math.min(val - levels[i - 1], levels[i] - val);
          }
          mask.data[j] = Math.max(0, 1 - Math.abs(dist) * cfg.phi);
        }
      }
      
      masks.push(mask);
    }
    
    return masks;
  }
  
  async apply(
    input: { sharpened: GrayscaleImage; original?: GrayscaleImage },
    configOverride?: Partial<HatchingConfig>
  ): Promise<GrayscaleImage> {
    const cfg = { ...this.config, ...configOverride };
    const { sharpened } = input;
    const { width, height } = sharpened;
    
    // Generate masks
    const masks = this.generateMasks(sharpened, cfg);
    
    // If no textures provided, create simple grayscale bands
    const output = createGrayscaleImage(width, height);
    
    if (!cfg.textures || cfg.textures.length === 0) {
      // Simple tonal bands without textures
      const numBands = masks.length;
      for (let i = 0; i < width * height; i++) {
        let value = 0;
        for (let b = 0; b < numBands; b++) {
          const bandValue = b / (numBands - 1); // 0 = black, 1 = white
          value += masks[b].data[i] * bandValue;
        }
        output.data[i] = Math.min(1, value);
      }
    } else {
      // Composite textures using masks
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          let value = cfg.paperTexture ? getPixel(cfg.paperTexture, x, y) : 1.0;
          
          // Multiply each texture by its mask
          for (let b = 0; b < Math.min(masks.length, cfg.textures.length); b++) {
            const maskVal = masks[b].data[idx];
            if (maskVal > 0) {
              const tex = cfg.textures[b];
              const texVal = this.sampleTexture(tex, x, y, width, height);
              value *= 1 - maskVal * (1 - texVal);
            }
          }
          
          output.data[idx] = value;
        }
      }
    }
    
    return output;
  }
  
  /**
   * Sample a texture with tiling and rotation
   */
  private sampleTexture(
    texture: HatchTexture,
    x: number,
    y: number,
    imageWidth: number,
    imageHeight: number
  ): number {
    const { data, rotation } = texture;
    
    // Apply rotation around image center
    const cx = imageWidth / 2;
    const cy = imageHeight / 2;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    
    const rx = (x - cx) * cos - (y - cy) * sin + cx;
    const ry = (x - cx) * sin + (y - cy) * cos + cy;
    
    // Tile the texture
    const tx = ((rx % data.width) + data.width) % data.width;
    const ty = ((ry % data.height) + data.height) % data.height;
    
    return getPixelBilinear(data, tx, ty);
  }
  
  /**
   * Generate a simple procedural hatching texture
   */
  static generateHatchTexture(
    width: number,
    height: number,
    spacing: number,
    thickness: number,
    rotation: number = 0
  ): HatchTexture {
    const data = createGrayscaleImage(width, height);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Create diagonal lines
        const linePos = (x + y) % spacing;
        const isLine = linePos < thickness;
        data.data[y * width + x] = isLine ? 0.2 : 1.0;
      }
    }
    
    return { data, rotation };
  }
}

// =============================================================================
// Natural Media Extension (Section 5.2)
// =============================================================================

/**
 * Natural media style presets
 */
export type NaturalMediaStyle = 'pencilShading' | 'pastel' | 'charcoal' | 'dryBrush';

/**
 * Natural media configuration
 * 
 * From Section 5.2: Parameters for various natural media looks
 */
export interface NaturalMediaConfig {
  /** Base style preset */
  style: NaturalMediaStyle;
  
  /** Override sigma for edge detection */
  sigma?: number;
  
  /** Override p for edge emphasis */
  p?: number;
  
  /** Override phi for threshold sharpness */
  phi?: number;
  
  /** Override epsilon for threshold level */
  epsilon?: number;
  
  /** For FDoG: structure tensor smoothing */
  sigmaC?: number;
  
  /** For FDoG: flow-aligned smoothing */
  sigmaM?: number;
  
  /** For FDoG: anti-aliasing */
  sigmaA?: number;
  
  /** Use flow-based processing (FDoG) */
  useFlow?: boolean;
}

/**
 * Natural Media Strategy
 * 
 * Provides preset parameter configurations for pencil, pastel, charcoal,
 * and other natural media styles as described in Section 5.2.
 * 
 * @example
 * ```typescript
 * const naturalMedia = new NaturalMediaStrategy({ style: 'pastel' });
 * const result = await naturalMedia.apply(input);
 * ```
 */
export class NaturalMediaStrategy implements ExtensionStrategy<
  NaturalMediaConfig,
  GrayscaleImage,
  GrayscaleImage
> {
  private config: NaturalMediaConfig;
  
  /**
   * Style presets from Section 5.2 and Table A.1
   */
  static readonly PRESETS: Record<NaturalMediaStyle, Partial<FDoGConfig> & { useFlow: boolean }> = {
    /**
     * Pencil shading: High-frequency detail resembling graphite on paper
     * Uses small σ ≈ 0.4 and φ ≈ 0.01 for gradual tones
     */
    pencilShading: {
      sigma: 0.4,
      k: 1.6,
      p: 20,
      epsilon: 0.5,
      phi: 0.01,
      useFlow: false,
    },
    
    /**
     * Pastel: Intermediate edge width with flow turbulence
     * σe ≈ 2, minimal σc, large σm for turbulence
     */
    pastel: {
      sigma: 2.0,
      k: 1.6,
      p: 40,
      epsilon: 1.0,
      phi: 0.01,
      sigmaC: 0.1,
      sigmaM: 20,
      sigmaA: 7.2,
      useFlow: true,
    },
    
    /**
     * Charcoal: Broad strokes from large spatial support
     * σe ≈ 7 for wide strokes
     */
    charcoal: {
      sigma: 7.0,
      k: 1.6,
      p: 70,
      epsilon: 0.8,
      phi: 0.01,
      sigmaC: 0.1,
      sigmaM: 20,
      sigmaA: 0.6,
      useFlow: true,
    },
    
    /**
     * Dry brush: Similar to pastel but with different anti-aliasing
     */
    dryBrush: {
      sigma: 3.0,
      k: 1.6,
      p: 50,
      epsilon: 0.9,
      phi: 0.01,
      sigmaC: 0.1,
      sigmaM: 15,
      sigmaA: 2.0,
      useFlow: true,
    },
  };
  
  constructor(config: Partial<NaturalMediaConfig> = {}) {
    this.config = { style: 'pencilShading', ...config };
  }
  
  /**
   * Get the resolved configuration for the current style
   */
  getResolvedConfig(): Partial<FDoGConfig> & { useFlow: boolean } {
    const preset = NaturalMediaStrategy.PRESETS[this.config.style];
    return {
      ...preset,
      ...(this.config.sigma !== undefined && { sigma: this.config.sigma }),
      ...(this.config.p !== undefined && { p: this.config.p }),
      ...(this.config.phi !== undefined && { phi: this.config.phi }),
      ...(this.config.epsilon !== undefined && { epsilon: this.config.epsilon }),
      ...(this.config.sigmaC !== undefined && { sigmaC: this.config.sigmaC }),
      ...(this.config.sigmaM !== undefined && { sigmaM: this.config.sigmaM }),
      ...(this.config.sigmaA !== undefined && { sigmaA: this.config.sigmaA }),
      useFlow: this.config.useFlow ?? preset.useFlow,
    };
  }
  
  async apply(
    input: GrayscaleImage,
    configOverride?: Partial<NaturalMediaConfig>
  ): Promise<GrayscaleImage> {
    const mergedConfig = { ...this.config, ...configOverride };
    const resolved = new NaturalMediaStrategy(mergedConfig).getResolvedConfig();
    
    if (resolved.useFlow) {
      const fdog = new FDoG(resolved as Partial<FDoGConfig>);
      return fdog.process(input);
    } else {
      const xdog = new XDoG(resolved);
      return xdog.process(input);
    }
  }
  
  /**
   * Create strategy for a specific style
   */
  static forStyle(style: NaturalMediaStyle): NaturalMediaStrategy {
    return new NaturalMediaStrategy({ style });
  }
}

// =============================================================================
// Color Retention Extension (Section 5.2)
// =============================================================================

/**
 * Color retention configuration
 */
export interface ColorRetentionConfig {
  /**
   * Blend mode for combining stylized and color
   * - 'multiply': Multiply color by inverted stylized
   * - 'overlay': Overlay blend mode
   * - 'softLight': Soft light blend
   * - 'luminosity': Replace luminosity only
   */
  blendMode: 'multiply' | 'overlay' | 'softLight' | 'luminosity';
  
  /**
   * Strength of color retention (0 = no color, 1 = full color)
   * Default: 1.0
   */
  strength: number;
  
  /**
   * Invert the stylized image before blending
   * Useful for line art where black should preserve color
   */
  invertStylized: boolean;
}

const DEFAULT_COLOR_CONFIG: ColorRetentionConfig = {
  blendMode: 'multiply',
  strength: 1.0,
  invertStylized: true,
};

/**
 * Color Retention Strategy
 * 
 * Modulates stylized output with source image colors.
 * From Section 5.2: "We achieve the colored pastel look by modulating
 * the natural media appearance with source image colors, which are
 * weighted by inverting the stylized result."
 * 
 * @example
 * ```typescript
 * const stylized = await fdog.process(grayInput);
 * const colorRetain = new ColorRetentionStrategy({ blendMode: 'multiply' });
 * const colorResult = await colorRetain.apply({
 *   stylized,
 *   originalColor: rgbInput
 * });
 * ```
 */
export class ColorRetentionStrategy implements ExtensionStrategy<
  ColorRetentionConfig,
  { stylized: GrayscaleImage; originalColor: RGBImage },
  RGBImage
> {
  private config: ColorRetentionConfig;
  
  constructor(config: Partial<ColorRetentionConfig> = {}) {
    this.config = { ...DEFAULT_COLOR_CONFIG, ...config };
  }
  
  async apply(
    input: { stylized: GrayscaleImage; originalColor: RGBImage },
    configOverride?: Partial<ColorRetentionConfig>
  ): Promise<RGBImage> {
    const cfg = { ...this.config, ...configOverride };
    const { stylized, originalColor } = input;
    const { width, height } = stylized;
    
    const output: RGBImage = {
      r: new Float32Array(width * height),
      g: new Float32Array(width * height),
      b: new Float32Array(width * height),
      width,
      height,
    };
    
    for (let i = 0; i < width * height; i++) {
      let s = stylized.data[i];
      if (cfg.invertStylized) {
        s = 1 - s;
      }
      
      const r = originalColor.r[i];
      const g = originalColor.g[i];
      const b = originalColor.b[i];
      
      let [outR, outG, outB] = this.blend(r, g, b, s, cfg.blendMode);
      
      // Apply strength
      output.r[i] = r + (outR - r) * cfg.strength;
      output.g[i] = g + (outG - g) * cfg.strength;
      output.b[i] = b + (outB - b) * cfg.strength;
    }
    
    return output;
  }
  
  private blend(
    r: number, g: number, b: number,
    s: number,
    mode: ColorRetentionConfig['blendMode']
  ): [number, number, number] {
    switch (mode) {
      case 'multiply':
        // Multiply color by (1 - stylized) to preserve color in white areas
        return [r * (1 - s), g * (1 - s), b * (1 - s)];
        
      case 'overlay':
        // Overlay blend
        return [
          this.overlayChannel(r, s),
          this.overlayChannel(g, s),
          this.overlayChannel(b, s),
        ];
        
      case 'softLight':
        // Soft light blend
        return [
          this.softLightChannel(r, s),
          this.softLightChannel(g, s),
          this.softLightChannel(b, s),
        ];
        
      case 'luminosity':
        // Replace luminosity while preserving color
        const origLum = 0.299 * r + 0.587 * g + 0.114 * b;
        const newLum = 1 - s;
        const lumDiff = newLum - origLum;
        return [
          Math.max(0, Math.min(1, r + lumDiff)),
          Math.max(0, Math.min(1, g + lumDiff)),
          Math.max(0, Math.min(1, b + lumDiff)),
        ];
    }
  }
  
  private overlayChannel(base: number, blend: number): number {
    if (base < 0.5) {
      return 2 * base * blend;
    }
    return 1 - 2 * (1 - base) * (1 - blend);
  }
  
  private softLightChannel(base: number, blend: number): number {
    if (blend < 0.5) {
      return base - (1 - 2 * blend) * base * (1 - base);
    }
    const d = base <= 0.25
      ? ((16 * base - 12) * base + 4) * base
      : Math.sqrt(base);
    return base + (2 * blend - 1) * (d - base);
  }
}

// =============================================================================
// Multi-Scale Extension
// =============================================================================

/**
 * Processor type that can be used in multi-scale layers
 */
export type DoGProcessor = XDoG | FDoG;

/**
 * Multi-scale layer configuration
 */
export interface MultiScaleLayer {
  /** Pre-configured XDoG or FDoG processor instance */
  processor: DoGProcessor;
  
  /** Weight for blending (will be normalized) */
  weight: number;
}

/**
 * Multi-scale configuration
 */
export interface MultiScaleConfig {
  /** Layer specifications with processor instances */
  layers: MultiScaleLayer[];
  
  /** 
   * Blend mode for combining layers
   * - 'average': Weighted average
   * - 'min': Take minimum (darkest)
   * - 'max': Take maximum (brightest)
   * - 'multiply': Multiply all layers
   */
  blendMode: 'average' | 'min' | 'max' | 'multiply';
}

/**
 * Multi-Scale Strategy
 * 
 * Combines XDoG/FDoG results at different scales for scale-space
 * edge detection. Accepts pre-configured processor instances, giving
 * developers full control over each layer's configuration.
 * 
 * From Section 3.1 (Abstraction): Different σ values capture different
 * levels of detail.
 * 
 * @example
 * ```typescript
 * const multiScale = new MultiScaleStrategy({
 *   layers: [
 *     { processor: new XDoG({ sigma: 0.5, p: 30 }), weight: 1 },
 *     { processor: new FDoG({ sigma: 2.0, sigmaM: 4.0 }), weight: 2 },
 *     { processor: XDoG.withPreset('pencilShading'), weight: 0.5 },
 *   ],
 *   blendMode: 'min',
 * });
 * const result = await multiScale.apply(input);
 * ```
 * 
 * @example Using with custom blur strategies
 * ```typescript
 * // Each processor can be configured independently
 * const multiScale = new MultiScaleStrategy({
 *   layers: [
 *     { processor: new XDoG({ sigma: 0.4, p: 20, phi: 100 }), weight: 2 },
 *     { processor: new FDoG({ sigma: 1.6, sigmaC: 2.5, sigmaM: 4.0 }), weight: 1 },
 *   ],
 *   blendMode: 'average',
 * });
 * ```
 */
export class MultiScaleStrategy implements ExtensionStrategy<
  MultiScaleConfig,
  GrayscaleImage,
  GrayscaleImage
> {
  private config: MultiScaleConfig;
  
  constructor(config: MultiScaleConfig) {
    this.config = config;
  }
  
  async apply(
    input: GrayscaleImage,
    configOverride?: Partial<Pick<MultiScaleConfig, 'blendMode'>>
  ): Promise<GrayscaleImage> {
    const blendMode = configOverride?.blendMode ?? this.config.blendMode;
    const { width, height } = input;
    
    // Process each layer using its pre-configured processor
    const layerResults: GrayscaleImage[] = [];
    
    for (const layer of this.config.layers) {
      const result = await layer.processor.process(input);
      layerResults.push(result);
    }
    
    // Blend layers
    return this.blendLayers(layerResults, this.config.layers, blendMode, width, height);
  }
  
  private blendLayers(
    layers: GrayscaleImage[],
    layerConfigs: MultiScaleLayer[],
    mode: MultiScaleConfig['blendMode'],
    width: number,
    height: number
  ): GrayscaleImage {
    const output = createGrayscaleImage(width, height);
    const size = width * height;
    
    // Normalize weights
    const totalWeight = layerConfigs.reduce((sum, l) => sum + l.weight, 0);
    const normalizedWeights = layerConfigs.map(l => l.weight / totalWeight);
    
    for (let i = 0; i < size; i++) {
      switch (mode) {
        case 'average': {
          let sum = 0;
          for (let j = 0; j < layers.length; j++) {
            sum += layers[j].data[i] * normalizedWeights[j];
          }
          output.data[i] = sum;
          break;
        }
        
        case 'min': {
          let min = 1;
          for (const layer of layers) {
            min = Math.min(min, layer.data[i]);
          }
          output.data[i] = min;
          break;
        }
        
        case 'max': {
          let max = 0;
          for (const layer of layers) {
            max = Math.max(max, layer.data[i]);
          }
          output.data[i] = max;
          break;
        }
        
        case 'multiply': {
          let prod = 1;
          for (const layer of layers) {
            prod *= layer.data[i];
          }
          output.data[i] = prod;
          break;
        }
      }
    }
    
    return output;
  }
  
  /**
   * Create a preset multi-scale configuration
   */
  static withPreset(preset: 'detailed' | 'balanced' | 'abstract'): MultiScaleStrategy {
    switch (preset) {
      case 'detailed':
        return new MultiScaleStrategy({
          layers: [
            { processor: new XDoG({ sigma: 0.4, p: 25, phi: 50 }), weight: 2 },
            { processor: new XDoG({ sigma: 1.0, p: 20, phi: 50 }), weight: 1 },
          ],
          blendMode: 'min',
        });
        
      case 'balanced':
        return new MultiScaleStrategy({
          layers: [
            { processor: new XDoG({ sigma: 0.8, p: 20 }), weight: 1 },
            { processor: new FDoG({ sigma: 1.6, sigmaM: 3.0 }), weight: 2 },
            { processor: new FDoG({ sigma: 3.2, sigmaM: 5.0 }), weight: 1 },
          ],
          blendMode: 'average',
        });
        
      case 'abstract':
        return new MultiScaleStrategy({
          layers: [
            { processor: new FDoG({ sigma: 2.0, sigmaM: 4.0 }), weight: 1 },
            { processor: new FDoG({ sigma: 5.0, sigmaM: 6.0 }), weight: 2 },
            { processor: new FDoG({ sigma: 10.0, sigmaM: 8.0 }), weight: 1 },
          ],
          blendMode: 'max',
        });
    }
  }
  
  /**
   * Get the configured layers (useful for inspection/debugging)
   */
  getLayers(): ReadonlyArray<MultiScaleLayer> {
    return this.config.layers;
  }
  
  /**
   * Get the blend mode
   */
  getBlendMode(): MultiScaleConfig['blendMode'] {
    return this.config.blendMode;
  }
}

// =============================================================================
// Pipeline Composer
// =============================================================================

/**
 * Pipeline step specification
 */
export type PipelineStep<TIn, TOut> = {
  name: string;
  apply: (input: TIn) => Promise<TOut>;
};

/**
 * Extension Pipeline
 * 
 * Composes multiple extension strategies into a single processing pipeline.
 * Provides type-safe chaining of operations.
 * 
 * @example
 * ```typescript
 * const pipeline = new ExtensionPipeline()
 *   .addStep('naturalMedia', async (input: GrayscaleImage) => {
 *     const nm = new NaturalMediaStrategy({ style: 'pastel' });
 *     return nm.apply(input);
 *   })
 *   .addStep('antiAlias', async (image: GrayscaleImage) => {
 *     const etf = EdgeTangentFlow.compute(originalInput);
 *     const aa = new AntiAliasingStrategy({ sigma: 1.5 });
 *     return aa.apply({ image, etf });
 *   });
 * 
 * const result = await pipeline.run(input);
 * ```
 */
export class ExtensionPipeline<TInput, TCurrent = TInput> {
  private steps: Array<{ name: string; fn: (input: any) => Promise<any> }> = [];
  
  /**
   * Add a processing step to the pipeline
   */
  addStep<TNext>(
    name: string,
    fn: (input: TCurrent) => Promise<TNext>
  ): ExtensionPipeline<TInput, TNext> {
    this.steps.push({ name, fn });
    return this as unknown as ExtensionPipeline<TInput, TNext>;
  }
  
  /**
   * Run the pipeline
   */
  async run(input: TInput): Promise<TCurrent> {
    let current: any = input;
    
    for (const step of this.steps) {
      current = await step.fn(current);
    }
    
    return current as TCurrent;
  }
  
  /**
   * Get step names for debugging
   */
  getStepNames(): string[] {
    return this.steps.map(s => s.name);
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Convert ImageData to RGBImage
 */
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

/**
 * Convert RGBImage to ImageData
 */
export function rgbToImageData(rgb: RGBImage): ImageData {
  const { width, height } = rgb;
  const imageData = new ImageData(width, height);
  const size = width * height;
  
  for (let i = 0; i < size; i++) {
    imageData.data[i * 4] = Math.round(Math.max(0, Math.min(255, rgb.r[i] * 255)));
    imageData.data[i * 4 + 1] = Math.round(Math.max(0, Math.min(255, rgb.g[i] * 255)));
    imageData.data[i * 4 + 2] = Math.round(Math.max(0, Math.min(255, rgb.b[i] * 255)));
    imageData.data[i * 4 + 3] = 255;
  }
  
  return imageData;
}

/**
 * Convert grayscale to RGB (same value in all channels)
 */
export function grayscaleToRGB(gray: GrayscaleImage): RGBImage {
  return {
    r: new Float32Array(gray.data),
    g: new Float32Array(gray.data),
    b: new Float32Array(gray.data),
    width: gray.width,
    height: gray.height,
  };
}

/**
 * Convert RGB to grayscale using luminance formula
 */
export function rgbToGrayscale(rgb: RGBImage): GrayscaleImage {
  const { width, height } = rgb;
  const gray = createGrayscaleImage(width, height);
  
  for (let i = 0; i < width * height; i++) {
    gray.data[i] = 0.299 * rgb.r[i] + 0.587 * rgb.g[i] + 0.114 * rgb.b[i];
  }
  
  return gray;
}