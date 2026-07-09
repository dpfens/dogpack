/**
 * High-level HDoG implementations
 *
 * This class provides a convenient wrapper that compose the blur strategies
 * and DoG processor together.
 */
import { type ChannelImage } from '../types.js';
import { type DoGImplementation, type HDoGConfig, type HDoGProcessingResult } from './types.js';
export declare class HDoG implements DoGImplementation {
    private fdog;
    private adogPrimary;
    private adogSecondary;
    constructor(config?: Partial<HDoGConfig>);
    dispose(): void;
    /**
     * Eq. (9): HDoG = FDoG ∧ ADoG_s ∧ ADoG_s'
     *
     * Note: HDoG's own configuration (fdog/adog/adogSecondaryScaleFactor) is
     * nested rather than a flat DoGConfig, so per-call overrides aren't
     * exposed here the way XDoG/FDoG/ADoG expose them -- there's no clean way
     * to map a flat Partial<DoGConfig> onto "override the nested fdog config,
     * or the nested adog config, or the scale factor". Configure via the
     * constructor; if you need per-call tuning, consider adding a dedicated
     * method (e.g. processWithConfig(input, HDoGConfig overrides)) rather than
     * overloading `process`.
     */
    process(input: ChannelImage): Promise<ChannelImage>;
    processDetailed(input: ChannelImage): Promise<HDoGProcessingResult>;
}
/**
 * Convenience function for one-shot HDoG processing, matching xdog()/fdog()
 * in dog.ts and adog() in adog.ts
 */
export declare function hdog(input: ChannelImage, config?: Partial<HDoGConfig>): Promise<ChannelImage>;
//# sourceMappingURL=hdog.d.ts.map