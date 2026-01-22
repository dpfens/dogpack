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
import { createGrayscaleImage, getPixel, getPixelBilinear, } from './utils.js';
import { XDoG, FDoG } from './xdog.js';
import { FlowGuidedBlur } from './blur/index.js';
const DEFAULT_AA_CONFIG = {
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
export class AntiAliasingStrategy {
    config;
    constructor(config = {}) {
        this.config = { ...DEFAULT_AA_CONFIG, ...config };
    }
    async apply(input, configOverride) {
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
    static withPreset(preset) {
        const presets = {
            subtle: { sigma: 0.5, stepSize: 0.5 },
            standard: { sigma: 1.0, stepSize: 0.5 },
            stylistic: { sigma: 3.0, stepSize: 0.5 },
        };
        return new AntiAliasingStrategy(presets[preset]);
    }
}
const DEFAULT_HATCHING_CONFIG = {
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
export class HatchingStrategy {
    config;
    constructor(config = {}) {
        this.config = { ...DEFAULT_HATCHING_CONFIG, ...config };
    }
    /**
     * Generate threshold masks for each tone band
     */
    generateMasks(sharpened, configOverride) {
        const cfg = { ...this.config, ...configOverride };
        const { width, height } = sharpened;
        const levels = [...cfg.thresholdLevels].sort((a, b) => a - b);
        // Create masks for each band
        // Band 0: below first threshold (darkest)
        // Band n: above last threshold (lightest)
        const masks = [];
        for (let i = 0; i <= levels.length; i++) {
            const mask = createGrayscaleImage(width, height);
            for (let j = 0; j < width * height; j++) {
                const val = sharpened.data[j];
                let inBand;
                if (i === 0) {
                    // Darkest band: below first threshold
                    inBand = val < levels[0];
                }
                else if (i === levels.length) {
                    // Lightest band: above last threshold
                    inBand = val >= levels[i - 1];
                }
                else {
                    // Middle bands
                    inBand = val >= levels[i - 1] && val < levels[i];
                }
                // Apply soft thresholding for smoother transitions
                if (inBand) {
                    mask.data[j] = 1.0;
                }
                else {
                    // Smooth falloff near boundaries
                    let dist = Infinity;
                    if (i === 0) {
                        dist = levels[0] - val;
                    }
                    else if (i === levels.length) {
                        dist = val - levels[i - 1];
                    }
                    else {
                        dist = Math.min(val - levels[i - 1], levels[i] - val);
                    }
                    mask.data[j] = Math.max(0, 1 - Math.abs(dist) * cfg.phi);
                }
            }
            masks.push(mask);
        }
        return masks;
    }
    async apply(input, configOverride) {
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
        }
        else {
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
    sampleTexture(texture, x, y, imageWidth, imageHeight) {
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
    static generateHatchTexture(width, height, spacing, thickness, rotation = 0) {
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
export class NaturalMediaStrategy {
    config;
    /**
     * Style presets from Section 5.2 and Table A.1
     */
    static PRESETS = {
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
    constructor(config = {}) {
        this.config = { style: 'pencilShading', ...config };
    }
    /**
     * Get the resolved configuration for the current style
     */
    getResolvedConfig() {
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
    async apply(input, configOverride) {
        const mergedConfig = { ...this.config, ...configOverride };
        const resolved = new NaturalMediaStrategy(mergedConfig).getResolvedConfig();
        if (resolved.useFlow) {
            const fdog = new FDoG(resolved);
            return fdog.process(input);
        }
        else {
            const xdog = new XDoG(resolved);
            return xdog.process(input);
        }
    }
    /**
     * Create strategy for a specific style
     */
    static forStyle(style) {
        return new NaturalMediaStrategy({ style });
    }
}
const DEFAULT_COLOR_CONFIG = {
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
export class ColorRetentionStrategy {
    config;
    constructor(config = {}) {
        this.config = { ...DEFAULT_COLOR_CONFIG, ...config };
    }
    async apply(input, configOverride) {
        const cfg = { ...this.config, ...configOverride };
        const { stylized, originalColor } = input;
        const { width, height } = stylized;
        const output = {
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
    blend(r, g, b, s, mode) {
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
    overlayChannel(base, blend) {
        if (base < 0.5) {
            return 2 * base * blend;
        }
        return 1 - 2 * (1 - base) * (1 - blend);
    }
    softLightChannel(base, blend) {
        if (blend < 0.5) {
            return base - (1 - 2 * blend) * base * (1 - base);
        }
        const d = base <= 0.25
            ? ((16 * base - 12) * base + 4) * base
            : Math.sqrt(base);
        return base + (2 * blend - 1) * (d - base);
    }
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
export class MultiScaleStrategy {
    config;
    constructor(config) {
        this.config = config;
    }
    async apply(input, configOverride) {
        const blendMode = configOverride?.blendMode ?? this.config.blendMode;
        const { width, height } = input;
        // Process each layer using its pre-configured processor
        const layerResults = [];
        for (const layer of this.config.layers) {
            const result = await layer.processor.process(input);
            layerResults.push(result);
        }
        // Blend layers
        return this.blendLayers(layerResults, this.config.layers, blendMode, width, height);
    }
    blendLayers(layers, layerConfigs, mode, width, height) {
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
    static withPreset(preset) {
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
    getLayers() {
        return this.config.layers;
    }
    /**
     * Get the blend mode
     */
    getBlendMode() {
        return this.config.blendMode;
    }
}
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
export class ExtensionPipeline {
    steps = [];
    /**
     * Add a processing step to the pipeline
     */
    addStep(name, fn) {
        this.steps.push({ name, fn });
        return this;
    }
    /**
     * Run the pipeline
     */
    async run(input) {
        let current = input;
        for (const step of this.steps) {
            current = await step.fn(current);
        }
        return current;
    }
    /**
     * Get step names for debugging
     */
    getStepNames() {
        return this.steps.map(s => s.name);
    }
}
// =============================================================================
// Utility Functions
// =============================================================================
/**
 * Convert ImageData to RGBImage
 */
export function imageDataToRGB(imageData) {
    const { width, height } = imageData;
    const size = width * height;
    const rgb = {
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
export function rgbToImageData(rgb) {
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
export function grayscaleToRGB(gray) {
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
export function rgbToGrayscale(rgb) {
    const { width, height } = rgb;
    const gray = createGrayscaleImage(width, height);
    for (let i = 0; i < width * height; i++) {
        gray.data[i] = 0.299 * rgb.r[i] + 0.587 * rgb.g[i] + 0.114 * rgb.b[i];
    }
    return gray;
}
//# sourceMappingURL=extensions.js.map