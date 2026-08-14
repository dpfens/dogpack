"use strict";
/**
 * ScalarField constructors and combinators.
 *
 * The type itself (`{ sample(i): number }`) lives in interfaces/base.ts
 * alongside ChannelImage, since it's a core data shape used across the
 * public API. This module is the equivalent of createChannelImage() for
 * that type: the runtime helpers for building and composing fields.
 *
 * Composition (map/blend/scale) is free until sampled. No intermediate
 * buffer is allocated unless you call materialize(). This matters because
 * DoGConfig's p/epsilon/phi are ScalarFields evaluated once per pixel
 * inside processor.ts's hot loops; building a config like
 * `ScalarField.blend(a, b, confidence)` doesn't cost anything up front.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScalarField = void 0;
exports.normalizedMagnitudeField = normalizedMagnitudeField;
exports.anisotropyField = anisotropyField;
exports.flowConfidenceField = flowConfidenceField;
const index_js_1 = require("./index.js");
exports.ScalarField = {
    /** A field that returns the same value everywhere. Replaces the old
     *  bare `number` half of the `number | ChannelImage` union: every
     *  literal default (e.g. p=20) becomes `ScalarField.constant(20)`. */
    constant(value) {
        return { sample: () => value };
    },
    /** Wrap an existing per-pixel buffer as a field. Replaces the old
     *  `ChannelImage` half of the union. */
    fromChannelImage(img) {
        return { sample: (i) => img.data[i] };
    },
    /** Pointwise transform. */
    map(field, fn) {
        return { sample: (i) => fn(field.sample(i)) };
    },
    /** Linear interpolation per pixel: weight=1 -> fully `a`, weight=0 ->
     *  fully `b`. This is the core operation behind confidence-weighting --
     *  e.g. `blend(flowSmoothed, raw, anisotropy)` trusts the flow-smoothed
     *  value only where the tangent direction is reliable. */
    blend(a, b, weight) {
        return {
            sample: (i) => {
                const w = weight.sample(i);
                return w * a.sample(i) + (1 - w) * b.sample(i);
            },
        };
    },
    /** Pointwise multiply. */
    scale(field, factor) {
        return { sample: (i) => field.sample(i) * factor.sample(i) };
    },
    /** Force evaluation into a flat buffer -- needed when a downstream
     *  consumer (e.g. a GPU backend that wants a real texture, not a
     *  per-pixel JS callback) can't work with a lazy field directly. */
    materialize(field, width, height) {
        const out = (0, index_js_1.createChannelImage)(width, height);
        const size = width * height;
        for (let i = 0; i < size; i++)
            out.data[i] = field.sample(i);
        return out;
    },
};
// The ScalarField *type* is declared in interfaces/base.ts (it's a core
// data shape, alongside ChannelImage/FlowField); the local `interface
// ScalarField extends BaseScalarField {}` above just re-surfaces it under
// this module's own export table. Callers can do either
//   import { ScalarField } from '.../interfaces/base.js'        // type only
//   import { ScalarField } from '.../utils/scalar-field.js'     // type + helpers
// from whichever module they're already pulling from.
/**
 * Bridge a FlowField's raw magnitude into a [0,1] ScalarField, normalized
 * against the field's own maximum. Raw magnitude has no fixed scale (it
 * depends on input contrast), so almost every consumer wants this rather
 * than getMagnitude() directly.
 *
 * Note: this does one O(width*height) pass up front to find the max, then
 * samples are O(1). If you need this for the same FlowField repeatedly,
 * compute it once and reuse the returned field.
 */
function normalizedMagnitudeField(flow) {
    const { width, height } = flow;
    const size = width * height;
    let max = 1e-6;
    for (let i = 0; i < size; i++) {
        max = Math.max(max, flow.getMagnitude(i % width, (i / width) | 0));
    }
    return {
        sample: (i) => flow.getMagnitude(i % width, (i / width) | 0) / max,
    };
}
/** Bridge a FlowField's per-pixel anisotropy into a ScalarField. Already
 *  in [0,1], no normalization needed. */
function anisotropyField(flow) {
    const { width } = flow;
    return {
        sample: (i) => flow.getAnisotropy(i % width, (i / width) | 0),
    };
}
/**
 * Composite "how much should we trust the flow direction here" signal.
 * Anisotropy alone answers "is there a coherent direction"; magnitude
 * alone answers "is there an edge here at all". Multiplying them treats
 * both flat regions (low magnitude, direction is meaningless) and
 * ambiguous regions (low anisotropy, e.g. corners or texture noise where
 * local gradients disagree) as low-confidence.
 *
 * This is the field FDoG passes as `confidence` to flow-aware blur
 * strategies, and the field it uses to build adaptive epsilon/p maps.
 */
function flowConfidenceField(flow) {
    return exports.ScalarField.scale(anisotropyField(flow), normalizedMagnitudeField(flow));
}
//# sourceMappingURL=scalar-field.js.map