import { GrayscaleImage } from "../types.js";
import { ExtensionStrategy } from "./base.js";
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
export declare class HatchingStrategy implements ExtensionStrategy<HatchingConfig, {
    sharpened: GrayscaleImage;
    original?: GrayscaleImage;
}, GrayscaleImage> {
    private config;
    constructor(config?: Partial<HatchingConfig>);
    /**
     * Generate threshold masks for each tone band
     */
    generateMasks(sharpened: GrayscaleImage, configOverride?: Partial<HatchingConfig>): GrayscaleImage[];
    apply(input: {
        sharpened: GrayscaleImage;
        original?: GrayscaleImage;
    }, configOverride?: Partial<HatchingConfig>): Promise<GrayscaleImage>;
    /**
     * Sample a texture with tiling and rotation
     */
    private sampleTexture;
    /**
     * Generate a simple procedural hatching texture
     */
    static generateHatchTexture(width: number, height: number, spacing: number, thickness: number, rotation?: number): HatchTexture;
}
//# sourceMappingURL=hatching.d.ts.map