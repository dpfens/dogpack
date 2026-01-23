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
    config;
    constructor(config) {
        this.config = config;
    }
    async apply(input, configOverride) {
        const cfg = { ...this.config, ...configOverride };
        const { stylized, originalColor } = input;
        const { width, height } = stylized;
        const size = width * height;
        // Shared state for hooks
        const state = new Map();
        // Run global pre-process
        if (cfg.preProcess) {
            cfg.preProcess(stylized, originalColor, state);
        }
        // Build transform chains
        const maskTransforms = this.buildMaskTransformChain(cfg);
        const colorTransforms = this.buildColorTransformChain(cfg);
        const postProcesses = this.buildPostProcessChain(cfg);
        // Create output
        const output = {
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
                const ctx = this.createPixelContext(x, y, index, width, height, stylized, originalColor, state);
                // Get initial values
                let mask = stylized.data[index];
                let color = [
                    originalColor.r[index],
                    originalColor.g[index],
                    originalColor.b[index],
                ];
                const origColor = [...color];
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
    buildMaskTransformChain(cfg) {
        const chain = [];
        if (cfg.maskTransform)
            chain.push(cfg.maskTransform);
        if (cfg.maskTransformChain)
            chain.push(...cfg.maskTransformChain);
        return chain;
    }
    buildColorTransformChain(cfg) {
        const chain = [];
        if (cfg.colorTransform)
            chain.push(cfg.colorTransform);
        if (cfg.colorTransformChain)
            chain.push(...cfg.colorTransformChain);
        return chain;
    }
    buildPostProcessChain(cfg) {
        const chain = [];
        if (cfg.postProcess)
            chain.push(cfg.postProcess);
        if (cfg.postProcessChain)
            chain.push(...cfg.postProcessChain);
        return chain;
    }
    createPixelContext(x, y, index, width, height, stylized, originalColor, state) {
        return {
            x,
            y,
            index,
            width,
            height,
            u: x / (width - 1),
            v: y / (height - 1),
            sampleColor: (dx, dy) => {
                const sx = clampInt(x + dx, 0, width - 1);
                const sy = clampInt(y + dy, 0, height - 1);
                const si = sy * width + sx;
                return [originalColor.r[si], originalColor.g[si], originalColor.b[si]];
            },
            sampleMask: (dx, dy) => {
                const sx = clampInt(x + dx, 0, width - 1);
                const sy = clampInt(y + dy, 0, height - 1);
                return stylized.data[sy * width + sx];
            },
            getState: (key) => state.get(key),
            setState: (key, value) => { state.set(key, value); },
        };
    }
    // ===========================================================================
    // Static Factory Methods
    // ===========================================================================
    /**
     * Create a strategy from a preset
     */
    static preset(name) {
        return new ColorRetentionStrategy(Presets[name]);
    }
    /**
     * Create a strategy with just a blend function
     */
    static withBlend(blend) {
        return new ColorRetentionStrategy({ blend });
    }
    /**
     * Builder pattern for constructing complex pipelines
     */
    static builder() {
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
    maskTransforms = [];
    colorTransforms = [];
    postProcesses = [];
    blendFn;
    preProcessHook;
    globalPostProcessHook;
    maskTransform(fn) {
        this.maskTransforms.push(fn);
        return this;
    }
    colorTransform(fn) {
        this.colorTransforms.push(fn);
        return this;
    }
    blend(fn) {
        this.blendFn = fn;
        return this;
    }
    postProcess(fn) {
        this.postProcesses.push(fn);
        return this;
    }
    preProcess(fn) {
        this.preProcessHook = fn;
        return this;
    }
    globalPostProcess(fn) {
        this.globalPostProcessHook = fn;
        return this;
    }
    build() {
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
    ]),
    /**
     * Screen blend: 1 - (1-color) * (1-mask)
     * Creates lighter results
     */
    screen: ((color, mask) => [
        1 - (1 - color[0]) * (1 - mask),
        1 - (1 - color[1]) * (1 - mask),
        1 - (1 - color[2]) * (1 - mask),
    ]),
    /**
     * Overlay blend: combines multiply and screen
     */
    overlay: ((color, mask) => {
        const overlay = (c, m) => c < 0.5 ? 2 * c * m : 1 - 2 * (1 - c) * (1 - m);
        return [overlay(color[0], mask), overlay(color[1], mask), overlay(color[2], mask)];
    }),
    /**
     * Soft light blend: gentler than overlay
     */
    softLight: ((color, mask) => {
        const soft = (c, m) => {
            if (m < 0.5) {
                return c - (1 - 2 * m) * c * (1 - c);
            }
            const d = c <= 0.25 ? ((16 * c - 12) * c + 4) * c : Math.sqrt(c);
            return c + (2 * m - 1) * (d - c);
        };
        return [soft(color[0], mask), soft(color[1], mask), soft(color[2], mask)];
    }),
    /**
     * Colored edges: black lines on colored background
     * Most common use case for line art + color
     */
    coloredEdges: (edgeStrength = 1.0) => {
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
    tintedLines: (darkness = 0.8) => {
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
    }),
    /**
     * Linear interpolation between color and grayscale edge
     */
    lerp: (edgeColor = [0, 0, 0]) => {
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
    }),
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
    gamma: (gamma) => (mask) => Math.pow(mask, gamma),
    /**
     * Clamp mask to range
     */
    clamp: (min, max) => (mask) => Math.max(min, Math.min(max, mask)),
    /**
     * Remap mask from [inMin, inMax] to [outMin, outMax]
     */
    remap: (inMin, inMax, outMin = 0, outMax = 1) => (mask) => outMin + (outMax - outMin) * ((mask - inMin) / (inMax - inMin)),
    /**
     * Invert the mask
     */
    invert: () => (mask) => 1 - mask,
    /**
     * Apply contrast adjustment
     */
    contrast: (amount) => (mask) => clamp((mask - 0.5) * amount + 0.5),
    /**
     * Threshold with soft edges
     */
    softThreshold: (threshold, softness = 0.1) => (mask) => clamp((mask - threshold + softness) / (2 * softness)),
    /**
     * Hard threshold (binary)
     */
    threshold: (threshold) => (mask) => mask > threshold ? 1 : 0,
    /**
     * Quantize to N levels
     */
    quantize: (levels) => (mask) => Math.round(mask * (levels - 1)) / (levels - 1),
    /**
     * Morphological dilation (expand dark/edge regions)
     */
    dilate: (radius = 1) => (mask, ctx) => {
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
    erode: (radius = 1) => (mask, ctx) => {
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
    blur: (radius = 1) => (mask, ctx) => {
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
    noise: (amount, seed = 12345) => {
        // Simple deterministic hash for reproducibility
        const hash = (x, y) => {
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
    saturation: (factor) => (color) => {
        const [h, s, l] = rgbToHsl(...color);
        return hslToRgb(h, clamp(s * factor), l);
    },
    /**
     * Adjust brightness
     */
    brightness: (amount) => (color) => {
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
    contrast: (amount) => (color) => [
        clamp((color[0] - 0.5) * amount + 0.5),
        clamp((color[1] - 0.5) * amount + 0.5),
        clamp((color[2] - 0.5) * amount + 0.5),
    ],
    /**
     * Shift hue
     */
    hueShift: (degrees) => (color) => {
        const [h, s, l] = rgbToHsl(...color);
        return hslToRgb((h + degrees / 360 + 1) % 1, s, l);
    },
    /**
     * Desaturate based on mask (less saturation in edge areas)
     */
    maskBasedDesaturate: (factor = 0.5) => (color, mask) => {
        const [h, s, l] = rgbToHsl(...color);
        const newS = s * (mask + (1 - mask) * (1 - factor));
        return hslToRgb(h, newS, l);
    },
    /**
     * Apply a color matrix transformation
     */
    colorMatrix: (matrix) => (color) => {
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
    sepia: (intensity = 1.0) => {
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
    temperature: (warmth) => (color) => {
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
    vignette: (strength = 0.3, radius = 0.7) => (color, _orig, _mask, ctx) => {
        const dist = Math.sqrt((ctx.u - 0.5) ** 2 + (ctx.v - 0.5) ** 2) / 0.707;
        const vignette = 1 - Math.max(0, (dist - radius) / (1 - radius)) * strength;
        return [color[0] * vignette, color[1] * vignette, color[2] * vignette];
    },
    /**
     * Add film grain
     */
    grain: (amount = 0.05, seed = 54321) => {
        const hash = (x, y) => {
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
    blendOriginal: (amount) => (color, orig) => [
        color[0] + (orig[0] - color[0]) * amount,
        color[1] + (orig[1] - color[1]) * amount,
        color[2] + (orig[2] - color[2]) * amount,
    ],
    /**
     * Clamp output to valid range
     */
    clampOutput: () => (color) => [clamp(color[0]), clamp(color[1]), clamp(color[2])],
    /**
     * Posterize (reduce color levels)
     */
    posterize: (levels) => (color) => [
        Math.round(color[0] * (levels - 1)) / (levels - 1),
        Math.round(color[1] * (levels - 1)) / (levels - 1),
        Math.round(color[2] * (levels - 1)) / (levels - 1),
    ],
    /**
     * Edge-aware sharpening
     */
    sharpenEdges: (amount = 0.5) => (color, orig, mask) => {
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
export const Presets = {
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
function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
}
function clampInt(value, min, max) {
    return Math.max(min, Math.min(max, Math.round(value)));
}
// HSL conversion
function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min)
        return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    switch (max) {
        case r:
            h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
            break;
        case g:
            h = ((b - r) / d + 2) / 6;
            break;
        default:
            h = ((r - g) / d + 4) / 6;
            break;
    }
    return [h, s, l];
}
function hslToRgb(h, s, l) {
    if (s === 0)
        return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (t) => {
        if (t < 0)
            t += 1;
        if (t > 1)
            t -= 1;
        if (t < 1 / 6)
            return p + (q - p) * 6 * t;
        if (t < 1 / 2)
            return q;
        if (t < 2 / 3)
            return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [hue2rgb(h + 1 / 3), hue2rgb(h), hue2rgb(h - 1 / 3)];
}
// HSV conversion
function rgbToHsv(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const v = max;
    const d = max - min;
    const s = max === 0 ? 0 : d / max;
    if (max === min)
        return [0, s, v];
    let h;
    switch (max) {
        case r:
            h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
            break;
        case g:
            h = ((b - r) / d + 2) / 6;
            break;
        default:
            h = ((r - g) / d + 4) / 6;
            break;
    }
    return [h, s, v];
}
function hsvToRgb(h, s, v) {
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
export function rgbToImageData(rgb) {
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
//# sourceMappingURL=color-retention.js.map