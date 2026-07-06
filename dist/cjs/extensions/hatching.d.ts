import type { ChannelImage } from "../core/types";
import type { ExtensionStrategy } from "./base";
/**
 * Hatching texture specification
 */
export interface HatchTexture {
    /** Grayscale texture data (tiled as needed) */
    data: ChannelImage;
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
    paperTexture?: ChannelImage;
    /**
     * Sharpening strength for threshold masks (default: 20)
     */
    p: number;
    /**
     * Smoothness of threshold transitions (default: 10)
     * Lower values = softer transitions between bands
     * Higher values = sharper band boundaries
     */
    phi: number;
    /**
     * Whether to use cumulative (tonal art map) style (default: true)
     * When true: darker areas accumulate more hatching layers
     * When false: each band is independent
     */
    cumulative: boolean;
}
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
 * const { sharpened } = await xdog.processDetailed(input);
 *
 * const hatching = new HatchingStrategy({
 *   thresholdLevels: [0.25, 0.5, 0.75],
 *   textures: [darkHatch, medHatch, lightHatch, white],
 * });
 * const result = await hatching.apply({ sharpened, original: input });
 * ```
 */
export declare class HatchingStrategy implements ExtensionStrategy<HatchingConfig, {
    sharpened: ChannelImage;
    original?: ChannelImage;
}, ChannelImage> {
    private config;
    constructor(config?: Partial<HatchingConfig>);
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
    generateMasks(sharpened: ChannelImage, configOverride?: Partial<HatchingConfig>): ChannelImage[];
    apply(input: {
        sharpened: ChannelImage;
        original?: ChannelImage;
    }, configOverride?: Partial<HatchingConfig>): Promise<ChannelImage>;
    /**
     * Sample a texture with tiling and rotation
     */
    private sampleTexture;
    /**
     * Generate a simple procedural hatching texture
     *
     * Creates parallel lines at the specified spacing and thickness.
     * The rotation parameter rotates the SAMPLING, not the line pattern itself.
     */
    static generateHatchTexture(width: number, height: number, spacing: number, thickness: number, rotation?: number): HatchTexture;
    /**
     * Generate a cross-hatching texture (two overlapping line patterns)
     */
    static generateCrossHatchTexture(width: number, height: number, spacing: number, thickness: number, angle1?: number, angle2?: number): HatchTexture;
}
//# sourceMappingURL=hatching.d.ts.map