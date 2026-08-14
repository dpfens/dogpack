"use strict";
/**
 * Strategy pattern for parameter maps. plain classes matching how
 * every Preprocessor/BlurStrategy elsewhere in this codebase is written.
 * `param` is the swap contract: ParameterMapPipeline.set() and
 * CompositeStrategy both check it before wiring a strategy in.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParameterMapPipeline = exports.CompositeStrategy = exports.StructureTensorAnisotropyStrategy = exports.StructureTensorMagnitudeStrategy = exports.DetailResidualStrategy = exports.LuminanceStrategy = exports.TextureStrategy = void 0;
exports.structureTensorStrategies = structureTensorStrategies;
const preprocessor_js_1 = require("../preprocess/preprocessors/preprocessor.js");
const cpu_js_1 = require("../preprocess/preprocessors/cpu.js");
const structure_tensor_js_1 = require("./structure-tensor.js");
const channel_map_ops_js_1 = require("./channel-map-ops.js");
/** Local-variance texture. High texture -> low p / high epsilon. */
class TextureStrategy {
    param;
    opts;
    config;
    constructor(param, opts, config = {}) {
        this.param = param;
        this.opts = opts;
        this.config = config;
    }
    async compute(input) {
        const texture = await new cpu_js_1.LocalVariancePreprocessor(this.config).process(input);
        return this.param === 'p'
            ? (0, channel_map_ops_js_1.lerpChannel)(this.opts.high, this.opts.low, texture)
            : (0, channel_map_ops_js_1.lerpChannel)(this.opts.low, this.opts.high, texture);
    }
    dispose() { }
}
exports.TextureStrategy = TextureStrategy;
/** Tone map (broad blur). Dark -> low epsilon (denser shading), light -> high epsilon. */
class LuminanceStrategy {
    opts;
    param = 'epsilon';
    blurPromise;
    constructor(opts) {
        this.opts = opts;
    }
    async compute(input) {
        this.blurPromise ??= preprocessor_js_1.GaussianBlur.create(this.opts.blurSigma ?? 8);
        const luminance = await (await this.blurPromise).process(input);
        return (0, channel_map_ops_js_1.lerpChannel)(this.opts.epsilonDark, this.opts.epsilonLight, luminance);
    }
    dispose() {
        this.blurPromise?.then((blur) => blur.dispose()).catch(() => { });
    }
}
exports.LuminanceStrategy = LuminanceStrategy;
/** |input - filter(input)| for any injected edge-preserving filter (Bilateral, Kuwahara, ...). */
class DetailResidualStrategy {
    param;
    filter;
    opts;
    constructor(param, filter, opts) {
        this.param = param;
        this.filter = filter;
        this.opts = opts;
    }
    async compute(input) {
        const smoothed = await this.filter.process(input);
        const residual = (0, channel_map_ops_js_1.normalizeChannel)((0, channel_map_ops_js_1.combineChannels)([input, smoothed], ([a, b]) => Math.abs(a - b)));
        return this.param === 'p'
            ? (0, channel_map_ops_js_1.lerpChannel)(this.opts.high, this.opts.low, residual)
            : (0, channel_map_ops_js_1.lerpChannel)(this.opts.low, this.opts.high, residual);
    }
    dispose() {
        this.filter.dispose();
    }
}
exports.DetailResidualStrategy = DetailResidualStrategy;
/** Structure-tensor magnitude. High confidence -> low epsilon (let it through easily). */
class StructureTensorMagnitudeStrategy {
    cache;
    opts;
    param = 'epsilon';
    constructor(cache, opts) {
        this.cache = cache;
        this.opts = opts;
    }
    async compute(input) {
        const { magnitude } = this.cache.get(input);
        const normalized = (0, channel_map_ops_js_1.mapChannel)(magnitude, (v) => Math.min(1, v / this.opts.saturateAt));
        return (0, channel_map_ops_js_1.lerpChannel)(this.opts.epsilonHigh, this.opts.epsilonLow, normalized);
    }
    dispose() { }
}
exports.StructureTensorMagnitudeStrategy = StructureTensorMagnitudeStrategy;
/** Structure-tensor anisotropy. Coherent line -> high phi (crisp binary). */
class StructureTensorAnisotropyStrategy {
    cache;
    opts;
    param = 'phi';
    constructor(cache, opts) {
        this.cache = cache;
        this.opts = opts;
    }
    async compute(input) {
        const { anisotropy } = this.cache.get(input);
        return (0, channel_map_ops_js_1.lerpChannel)(this.opts.phiLow, this.opts.phiHigh, anisotropy);
    }
    dispose() { }
}
exports.StructureTensorAnisotropyStrategy = StructureTensorAnisotropyStrategy;
/**
 * Shared per-input tensor cache, keyed by ChannelImage reference. Magnitude
 * and anisotropy strategies both read from the same e/f/g, so wiring them
 * to one cache (via structureTensorStrategies() below) avoids computing
 * the tensor twice per frame.
 */
class StructureTensorCache {
    smoothingRadius;
    cache = new WeakMap();
    constructor(smoothingRadius) {
        this.smoothingRadius = smoothingRadius;
    }
    get(input) {
        let maps = this.cache.get(input);
        if (!maps)
            this.cache.set(input, (maps = (0, structure_tensor_js_1.computeStructureTensorMaps)(input, this.smoothingRadius)));
        return maps;
    }
}
/** Builds the magnitude/anisotropy pair sharing one StructureTensorCache. */
function structureTensorStrategies(opts) {
    const cache = new StructureTensorCache(opts.smoothingRadius ?? 2);
    return {
        magnitude: new StructureTensorMagnitudeStrategy(cache, opts.epsilon),
        anisotropy: new StructureTensorAnisotropyStrategy(cache, opts.phi),
    };
}
// ---- Combinators ---------------------------------------------------------
/** Combines strategies driving the same param. `mode: 'blend'` averages
 *  independent votes; `'requireAll'` multiplies, so each acts as a veto. */
class CompositeStrategy {
    param;
    entries;
    mode;
    constructor(param, entries, mode = 'blend') {
        this.param = param;
        this.entries = entries;
        this.mode = mode;
        for (const e of entries) {
            if (e.strategy.param !== param) {
                throw new Error(`CompositeStrategy(${param}): got a strategy tagged '${e.strategy.param}'`);
            }
        }
    }
    async compute(input) {
        const maps = await Promise.all(this.entries.map((e) => e.strategy.compute(input)));
        return this.mode === 'blend'
            ? (0, channel_map_ops_js_1.blendChannels)(maps.map((map, i) => ({ map, weight: this.entries[i].weight ?? 1 })))
            : (0, channel_map_ops_js_1.multiplyChannels)(maps);
    }
    dispose() {
        this.entries.forEach((e) => e.strategy.dispose());
    }
}
exports.CompositeStrategy = CompositeStrategy;
/** Registers a strategy per param; `build()` produces DoGConfig-ready overrides. */
class ParameterMapPipeline {
    strategies;
    constructor(strategies) {
        this.strategies = strategies;
    }
    async build(input) {
        const entries = Object.entries(this.strategies);
        const results = await Promise.all(entries.map(([, s]) => s.compute(input)));
        const overrides = {};
        entries.forEach(([param], i) => {
            overrides[param] = results[i];
        });
        return overrides;
    }
    /** Swap the strategy registered for a param, disposing the old one. */
    set(param, strategy) {
        if (strategy.param !== param) {
            throw new Error(`ParameterMapPipeline.set('${param}'): strategy is tagged '${strategy.param}'`);
        }
        this.strategies[param]?.dispose();
        this.strategies[param] = strategy;
    }
    dispose() {
        Object.values(this.strategies).forEach((s) => s?.dispose());
    }
}
exports.ParameterMapPipeline = ParameterMapPipeline;
//# sourceMappingURL=strategies.js.map