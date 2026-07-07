import type { FlowField, ChannelImage } from '../types.js';
import type { ExtensionStrategy } from './base.js';
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
export declare class AntiAliasingStrategy implements ExtensionStrategy<AntiAliasingConfig, {
    image: ChannelImage;
    etf: FlowField;
}, ChannelImage> {
    private config;
    constructor(config?: Partial<AntiAliasingConfig>);
    apply(input: {
        image: ChannelImage;
        etf: FlowField;
    }, configOverride?: Partial<AntiAliasingConfig>): Promise<ChannelImage>;
    /**
     * Create anti-aliasing with preset intensity
     */
    static withPreset(preset: 'subtle' | 'standard' | 'stylistic'): AntiAliasingStrategy;
}
//# sourceMappingURL=anti-alias.d.ts.map