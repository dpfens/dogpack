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
import type { ChannelImage, FlowField } from '../interfaces/base.js';
import type { ScalarField as BaseScalarField } from '../interfaces/base.js';
export interface ScalarField extends BaseScalarField {
}
export declare const ScalarField: {
    /** A field that returns the same value everywhere. Replaces the old
     *  bare `number` half of the `number | ChannelImage` union: every
     *  literal default (e.g. p=20) becomes `ScalarField.constant(20)`. */
    constant(value: number): ScalarField;
    /** Wrap an existing per-pixel buffer as a field. Replaces the old
     *  `ChannelImage` half of the union. */
    fromChannelImage(img: ChannelImage): ScalarField;
    /** Pointwise transform. */
    map(field: ScalarField, fn: (value: number) => number): ScalarField;
    /** Linear interpolation per pixel: weight=1 -> fully `a`, weight=0 ->
     *  fully `b`. This is the core operation behind confidence-weighting --
     *  e.g. `blend(flowSmoothed, raw, anisotropy)` trusts the flow-smoothed
     *  value only where the tangent direction is reliable. */
    blend(a: ScalarField, b: ScalarField, weight: ScalarField): ScalarField;
    /** Pointwise multiply. */
    scale(field: ScalarField, factor: ScalarField): ScalarField;
    /** Force evaluation into a flat buffer -- needed when a downstream
     *  consumer (e.g. a GPU backend that wants a real texture, not a
     *  per-pixel JS callback) can't work with a lazy field directly. */
    materialize(field: ScalarField, width: number, height: number): ChannelImage;
};
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
export declare function normalizedMagnitudeField(flow: FlowField): ScalarField;
/** Bridge a FlowField's per-pixel anisotropy into a ScalarField. Already
 *  in [0,1], no normalization needed. */
export declare function anisotropyField(flow: FlowField): ScalarField;
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
export declare function flowConfidenceField(flow: FlowField): ScalarField;
//# sourceMappingURL=scalar-field.d.ts.map