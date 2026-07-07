"use strict";
/**
 * High-level XDoG and FDoG implementations
 *
 * These classes provide convenient wrappers that compose the blur strategies
 * and DoG processor together.
 *
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HDoG = void 0;
exports.hdog = hdog;
const utils_1 = require("../utils");
const adog_1 = require("./adog");
const fdog_1 = require("./fdog");
const types_1 = require("./types");
class HDoG {
    fdog;
    adogPrimary;
    adogSecondary;
    constructor(config = {}) {
        const merged = { ...types_1.DEFAULT_HDOG_CONFIG, ...config };
        const primaryConfig = { ...types_1.DEFAULT_ADOG_CONFIG, ...merged.adog };
        const secondaryConfig = {
            ...primaryConfig,
            s: primaryConfig.s * merged.adogSecondaryScaleFactor,
        };
        this.fdog = new fdog_1.FDoG(merged.fdog);
        this.adogPrimary = new adog_1.ADoG(primaryConfig);
        this.adogSecondary = new adog_1.ADoG(secondaryConfig);
    }
    dispose() {
        this.fdog.dispose();
        this.adogPrimary.dispose();
        this.adogSecondary.dispose();
    }
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
    async process(input) {
        const [lines, tone1, tone2] = await Promise.all([
            this.fdog.process(input),
            this.adogPrimary.process(input),
            this.adogSecondary.process(input),
        ]);
        return (0, utils_1.andCombine)([lines, tone1, tone2]);
    }
    async processDetailed(input) {
        const [fdogDetailed, adog1Detailed, adog2Detailed] = await Promise.all([
            this.fdog.processDetailed(input),
            this.adogPrimary.processDetailed(input),
            this.adogSecondary.processDetailed(input),
        ]);
        const result = (0, utils_1.andCombine)([
            fdogDetailed.result,
            adog1Detailed.result,
            adog2Detailed.result,
        ]);
        return {
            result,
            sharpened: fdogDetailed.sharpened,
            fdogResult: fdogDetailed.result,
            adogPrimaryResult: adog1Detailed.result,
            adogSecondaryResult: adog2Detailed.result,
        };
    }
}
exports.HDoG = HDoG;
/**
 * Convenience function for one-shot HDoG processing, matching xdog()/fdog()
 * in dog.ts and adog() in adog.ts
 */
async function hdog(input, config = {}) {
    const processor = new HDoG(config);
    const result = await processor.process(input);
    processor.dispose();
    return result;
}
//# sourceMappingURL=hdog.js.map