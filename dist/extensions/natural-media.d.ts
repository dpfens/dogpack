import { FDoGConfig, ChannelImage } from "../types.js";
import { ExtensionStrategy } from "./base.js";
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
export declare class NaturalMediaStrategy implements ExtensionStrategy<NaturalMediaConfig, ChannelImage, ChannelImage> {
    private config;
    /**
     * Style presets from Section 5.2 and Table A.1
     *
     * Note on epsilon values:
     * - epsilon is the threshold for white vs black transition (0-1 range)
     * - Values ABOVE epsilon become white, values BELOW follow soft threshold
     * - For natural media effects, we want lower epsilon values to preserve
     *   more tonal variation and avoid all-white output
     */
    static readonly PRESETS: Record<NaturalMediaStyle, Partial<FDoGConfig> & {
        useFlow: boolean;
    }>;
    constructor(config?: Partial<NaturalMediaConfig>);
    /**
     * Get the resolved configuration for the current style
     */
    getResolvedConfig(): Partial<FDoGConfig> & {
        useFlow: boolean;
    };
    apply(input: ChannelImage, configOverride?: Partial<NaturalMediaConfig>): Promise<ChannelImage>;
    /**
     * Create strategy for a specific style
     */
    static forStyle(style: NaturalMediaStyle): NaturalMediaStrategy;
}
//# sourceMappingURL=natural-media.d.ts.map