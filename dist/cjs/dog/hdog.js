"use strict";
/**
 * High-level HDoG implementations
 *
 * This class provides a convenient wrapper that compose the blur strategies
 * and DoG processor together.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HDoG = void 0;
exports.hdog = hdog;
const adog_js_1 = require("./adog.js");
const fdog_js_1 = require("./fdog.js");
const dog_js_1 = require("../interfaces/dog.js");
const image_js_1 = require("../utils/image.js");
class HDoG {
    fdog;
    adogPrimary;
    adogSecondary;
    constructor(config = {}) {
        const merged = { ...dog_js_1.DEFAULT_HDOG_CONFIG, ...config };
        const primaryADoGConfig = { ...dog_js_1.DEFAULT_ADOG_CONFIG, ...merged.adog };
        const secondaryADoGConfig = {
            ...dog_js_1.DEFAULT_ADOG_CONFIG,
            ...primaryADoGConfig,
            s: primaryADoGConfig.s * merged.adogSecondaryScaleFactor,
            ...merged.adogSecondary,
        };
        this.fdog = new fdog_js_1.FDoG(merged.fdog);
        this.adogPrimary = new adog_js_1.ADoG(primaryADoGConfig);
        this.adogSecondary = new adog_js_1.ADoG(secondaryADoGConfig);
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
        return andCombine([lines, tone1, tone2]);
    }
    async processDetailed(input) {
        const [fdogDetailed, adog1Detailed, adog2Detailed] = await Promise.all([
            this.fdog.processDetailed(input),
            this.adogPrimary.processDetailed(input),
            this.adogSecondary.processDetailed(input),
        ]);
        const result = andCombine([
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
 * Pixel-wise logical AND across N binarized (0/1) ChannelImages.
 *
 * Generalizes Eq. (7)/(9) from "Gaussian Image Binarization":
 *   HDoG = FDoG ∧ ADoG_s ∧ ADoG_s'
 *
 * Since binarized images only contain 0 or 1, logical AND is equivalent to
 * taking the minimum across images (no De Morgan's / inversion needed here
 * -- see the paper's Eq. (8) for why AND and "invert-OR-invert" coincide;
 * this just implements AND directly).
 *
 * All images must have matching dimensions; this is not checked here for
 * performance -- validate upstream if inputs could mismatch.
 */
function andCombine(images) {
    if (images.length === 0) {
        throw new Error('andCombine requires at least one image');
    }
    const { width, height } = images[0];
    const output = (0, image_js_1.createChannelImage)(width, height);
    const size = width * height;
    for (let i = 0; i < size; i++) {
        let v = 1;
        for (const img of images) {
            v = Math.min(v, img.data[i]);
        }
        output.data[i] = v;
    }
    return output;
}
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