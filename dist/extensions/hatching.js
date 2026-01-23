import { createGrayscaleImage, getPixel, getPixelBilinear } from "../utils.js";
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
//# sourceMappingURL=hatching.js.map