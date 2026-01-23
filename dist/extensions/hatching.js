import { createGrayscaleImage, getPixel, getPixelBilinear } from "../utils.js";
const DEFAULT_HATCHING_CONFIG = {
    thresholdLevels: [0.3, 0.5, 0.7],
    p: 20,
    phi: 10, // Lowered from 100 for smoother transitions
    cumulative: true,
};
/**
 * Hatching Strategy
 *
 * Creates tonal art maps by computing multiple threshold levels from a
 * sharpened XDoG/FDoG image and using them as masks for hatching textures.
 *
 * The key insight from tonal art maps is that darker tones are achieved by
 * ACCUMULATING hatching layers - dark areas have all hatching layers active,
 * while light areas have none.
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
     * Generate cumulative threshold masks for tonal art maps
     *
     * For tonal art maps, we generate masks where:
     * - Mask 0 (darkest hatching): active where input < levels[0]
     * - Mask 1: active where input < levels[1]
     * - Mask N (lightest): active everywhere (or where input < 1.0)
     *
     * Each darker mask is a SUBSET of the lighter masks, creating the
     * cumulative effect where dark areas have more hatching.
     */
    generateMasks(sharpened, configOverride) {
        const cfg = { ...this.config, ...configOverride };
        const { width, height } = sharpened;
        const levels = [...cfg.thresholdLevels].sort((a, b) => a - b);
        const masks = [];
        if (cfg.cumulative) {
            // Cumulative masks for tonal art maps
            // Each mask covers "below this threshold"
            // Darkest areas activate ALL masks, lightest activate NONE
            for (let i = 0; i < levels.length; i++) {
                const mask = createGrayscaleImage(width, height);
                const threshold = levels[i];
                for (let j = 0; j < width * height; j++) {
                    const val = sharpened.data[j];
                    // Soft threshold with smooth falloff
                    // Active (1.0) when val < threshold, fading as val approaches threshold
                    const diff = threshold - val;
                    if (diff > 0) {
                        // Below threshold: fully active with soft edge
                        mask.data[j] = Math.min(1.0, diff * cfg.phi + 0.5);
                    }
                    else {
                        // Above threshold: fade out
                        mask.data[j] = Math.max(0, 0.5 + diff * cfg.phi);
                    }
                }
                masks.push(mask);
            }
            // Add a final "base" mask that's always slightly active for paper texture
            const baseMask = createGrayscaleImage(width, height);
            for (let j = 0; j < width * height; j++) {
                baseMask.data[j] = 0.0; // No hatching in lightest areas
            }
            masks.push(baseMask);
        }
        else {
            // Non-cumulative: independent bands (original behavior, but fixed)
            for (let i = 0; i <= levels.length; i++) {
                const mask = createGrayscaleImage(width, height);
                const lowerBound = i === 0 ? 0 : levels[i - 1];
                const upperBound = i === levels.length ? 1 : levels[i];
                const bandCenter = (lowerBound + upperBound) / 2;
                const bandWidth = upperBound - lowerBound;
                for (let j = 0; j < width * height; j++) {
                    const val = sharpened.data[j];
                    if (val >= lowerBound && val < upperBound) {
                        // Inside band: full intensity with soft edges
                        const distFromCenter = Math.abs(val - bandCenter);
                        const normalizedDist = distFromCenter / (bandWidth / 2);
                        mask.data[j] = 1.0 - normalizedDist * normalizedDist * 0.3; // Slight falloff at edges
                    }
                    else {
                        // Outside band: smooth falloff
                        const distFromBand = val < lowerBound ? lowerBound - val : val - upperBound;
                        mask.data[j] = Math.max(0, 1.0 - distFromBand * cfg.phi);
                    }
                }
                masks.push(mask);
            }
        }
        return masks;
    }
    async apply(input, configOverride) {
        const cfg = { ...this.config, ...configOverride };
        const { sharpened } = input;
        const { width, height } = sharpened;
        // Generate masks
        const masks = this.generateMasks(sharpened, cfg);
        const output = createGrayscaleImage(width, height);
        if (!cfg.textures || cfg.textures.length === 0) {
            // Simple tonal bands without textures
            // Map input luminance to output with quantized bands
            const numBands = masks.length;
            for (let i = 0; i < width * height; i++) {
                if (cfg.cumulative) {
                    // Count how many masks are active at this pixel
                    let activeMasks = 0;
                    for (let b = 0; b < masks.length - 1; b++) {
                        activeMasks += masks[b].data[i];
                    }
                    // More active masks = darker output
                    output.data[i] = 1.0 - (activeMasks / (numBands - 1));
                }
                else {
                    // Weighted sum of band values
                    let value = 0;
                    for (let b = 0; b < numBands; b++) {
                        const bandValue = b / (numBands - 1); // 0 = black, 1 = white
                        value += masks[b].data[i] * bandValue;
                    }
                    output.data[i] = Math.min(1, value);
                }
            }
        }
        else {
            // Composite textures using masks (tonal art map approach)
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = y * width + x;
                    // Start with paper/white
                    let value = cfg.paperTexture ? getPixel(cfg.paperTexture, x, y) : 1.0;
                    if (cfg.cumulative) {
                        // Tonal art maps: darker areas accumulate more hatching
                        // Apply textures from lightest to darkest, darkening where masks are active
                        const numTextures = Math.min(masks.length, cfg.textures.length);
                        for (let b = numTextures - 1; b >= 0; b--) {
                            const maskVal = masks[b].data[idx];
                            if (maskVal > 0.01) {
                                const tex = cfg.textures[b];
                                const texVal = this.sampleTexture(tex, x, y, width, height);
                                // Darken by the texture where the mask is active
                                // texVal of 0.2 (dark line) should darken; 1.0 (white) no change
                                value = value * (1.0 - maskVal * (1.0 - texVal));
                            }
                        }
                    }
                    else {
                        // Independent bands: blend textures based on mask weights
                        let totalWeight = 0;
                        let weightedValue = 0;
                        for (let b = 0; b < Math.min(masks.length, cfg.textures.length); b++) {
                            const maskVal = masks[b].data[idx];
                            if (maskVal > 0.01) {
                                const tex = cfg.textures[b];
                                const texVal = this.sampleTexture(tex, x, y, width, height);
                                weightedValue += maskVal * texVal;
                                totalWeight += maskVal;
                            }
                        }
                        if (totalWeight > 0) {
                            value = weightedValue / totalWeight;
                        }
                    }
                    output.data[idx] = Math.max(0, Math.min(1, value));
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
     *
     * Creates parallel lines at the specified spacing and thickness.
     * The rotation parameter rotates the SAMPLING, not the line pattern itself.
     */
    static generateHatchTexture(width, height, spacing, thickness, rotation = 0) {
        const data = createGrayscaleImage(width, height);
        // Create horizontal lines (rotation is applied during sampling)
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                // Simple horizontal stripe pattern
                const linePos = y % spacing;
                const isLine = linePos < thickness;
                // Add slight anti-aliasing at line edges
                let value;
                if (isLine) {
                    value = 0.15; // Dark line
                }
                else if (linePos === thickness) {
                    value = 0.5; // Edge transition
                }
                else {
                    value = 1.0; // White space
                }
                data.data[y * width + x] = value;
            }
        }
        return { data, rotation };
    }
    /**
     * Generate a cross-hatching texture (two overlapping line patterns)
     */
    static generateCrossHatchTexture(width, height, spacing, thickness, angle1 = 0, angle2 = Math.PI / 2) {
        const data = createGrayscaleImage(width, height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                // First set of lines
                const pos1 = (x * Math.cos(angle1) + y * Math.sin(angle1)) % spacing;
                const isLine1 = pos1 >= 0 && pos1 < thickness;
                // Second set of lines (perpendicular or at angle)
                const pos2 = (x * Math.cos(angle2) + y * Math.sin(angle2)) % spacing;
                const isLine2 = pos2 >= 0 && pos2 < thickness;
                let value = 1.0;
                if (isLine1 && isLine2) {
                    value = 0.05; // Darkest at intersections
                }
                else if (isLine1 || isLine2) {
                    value = 0.2; // Single line
                }
                data.data[y * width + x] = value;
            }
        }
        return { data, rotation: 0 };
    }
}
//# sourceMappingURL=hatching.js.map