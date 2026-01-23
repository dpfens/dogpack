import { FlowGuidedBlur } from "../blur/index.js";
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
//# sourceMappingURL=anti-alias.js.map