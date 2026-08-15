"use strict";
/**
 * Blur strategies for DoG processing
 *
 * Provides both isotropic (standard) and anisotropic (flow-guided) blur
 * implementations for use in XDoG and FDoG pipelines.
 *
 * Supports parallel/concurrent blur operations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IsotropicBlur = void 0;
const filters_js_1 = require("../filters/filters.js");
/**
 * Backend-agnostic isotropic blur. Picks the best backend this device
 * actually supports for *this algorithm* (not a global session-wide
 * choice), and falls back to the next-best backend if the active one
 * fails mid-session (lost context, driver crash, etc.).
 *
 * Construction is async (`IsotropicBlur.create()`) because backend
 * detection is inherently async; constructors can't be async, so a
 * private constructor plus a static factory forces detection to
 * complete before the instance is usable.
 */
class IsotropicBlur {
    filter;
    constructor(filter) {
        this.filter = filter;
    }
    static async create(config = {}) {
        return new IsotropicBlur(await filters_js_1.IsotropicBlurFilter.create(config));
    }
    get backend() {
        return this.filter.backend;
    }
    dispose() {
        this.filter.dispose();
    }
    async blur(input, sigma) {
        return this.filter.apply(input, { sigma });
    }
}
exports.IsotropicBlur = IsotropicBlur;
//# sourceMappingURL=isotropic.js.map