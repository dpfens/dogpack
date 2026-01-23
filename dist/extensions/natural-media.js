import { FDoG, XDoG } from "../xdog.js";
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
     *
     * Note on epsilon values:
     * - epsilon is the threshold for white vs black transition (0-1 range)
     * - Values ABOVE epsilon become white, values BELOW follow soft threshold
     * - For natural media effects, we want lower epsilon values to preserve
     *   more tonal variation and avoid all-white output
     */
    static PRESETS = {
        /**
         * Pencil shading: High-frequency detail resembling graphite on paper
         * Uses small σ ≈ 0.4 and φ ≈ 0.01 for gradual tones
         */
        pencilShading: {
            sigma: 0.4,
            k: 1.6,
            p: 7,
            epsilon: 0.5,
            phi: 5.00,
            useFlow: false,
        },
        /**
         * Pastel: Intermediate edge width with flow turbulence
         * σe ≈ 2, minimal σc, large σm for turbulence
         *
         * Fixed: epsilon was 1.0 which caused all-white output.
         * With epsilon=1.0 and soft threshold (phi=0.01), all normalized
         * pixel values (0-1) fall at or below threshold, producing white.
         * Lowered to 0.75 to preserve tonal range while keeping light appearance.
         */
        pastel: {
            sigma: 2.0,
            k: 1.6,
            p: 40,
            epsilon: 0.75, // Fixed: was 1.0, causing all-white output
            phi: 5.00,
            sigmaC: 0.1,
            sigmaM: 20,
            sigmaA: 7.2,
            useFlow: true,
        },
        /**
         * Charcoal: Broad strokes from large spatial support
         * σe ≈ 7 for wide strokes
         *
         * Fixed: epsilon was 0.8 which with phi=0.01 was too high,
         * causing very washed-out or mostly white results.
         * Lowered to 0.6 for better tonal range in charcoal style.
         */
        charcoal: {
            sigma: 7.0,
            k: 1.6,
            p: 70,
            epsilon: 0.6, // Fixed: was 0.8, causing washed-out output
            phi: 5.00,
            sigmaC: 0.1,
            sigmaM: 20,
            sigmaA: 0.6,
            useFlow: true,
        },
        /**
         * Dry brush: Similar to pastel but with different anti-aliasing
         *
         * Fixed: epsilon was 0.9 which caused mostly white output.
         * Lowered to 0.7 for better stroke visibility.
         */
        dryBrush: {
            sigma: 3.0,
            k: 1.6,
            p: 50,
            epsilon: 0.7, // Fixed: was 0.9, causing mostly white output
            phi: 5.00,
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
//# sourceMappingURL=natural-media.js.map