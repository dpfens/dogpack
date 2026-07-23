"use strict";
/**
 * Elementwise composition primitives for parameter maps (ChannelImage
 * used as p / epsilon / phi overrides in DoGConfig).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapChannel = mapChannel;
exports.combineChannels = combineChannels;
exports.constantChannel = constantChannel;
exports.lerpChannel = lerpChannel;
exports.normalizeChannel = normalizeChannel;
exports.multiplyChannels = multiplyChannels;
exports.blendChannels = blendChannels;
function assertSameShape(a, b) {
    if (a.width !== b.width || a.height !== b.height) {
        throw new Error(`ChannelImage shape mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
    }
}
function mapChannel(image, fn) {
    const data = new Float32Array(image.data.length);
    for (let i = 0; i < image.data.length; i++)
        data[i] = fn(image.data[i], i);
    return { data, width: image.width, height: image.height };
}
function combineChannels(images, fn) {
    const [first, ...rest] = images;
    for (const img of rest)
        assertSameShape(first, img);
    const data = new Float32Array(first.data.length);
    const scratch = new Array(images.length);
    for (let i = 0; i < data.length; i++) {
        for (let m = 0; m < images.length; m++)
            scratch[m] = images[m].data[i];
        data[i] = fn(scratch, i);
    }
    return { data, width: first.width, height: first.height };
}
function constantChannel(value, like) {
    return { data: new Float32Array(like.data.length).fill(value), width: like.width, height: like.height };
}
/** low where weight=0, high where weight=1. Any of the three may be a plain number. */
function lerpChannel(low, high, weight) {
    const ref = [low, high, weight].find((v) => typeof v !== 'number');
    const asImg = (v) => (typeof v === 'number' ? constantChannel(v, ref) : v);
    return combineChannels([asImg(low), asImg(high), asImg(weight)], ([l, h, w]) => l + (h - l) * w);
}
function normalizeChannel(image) {
    let min = Infinity, max = -Infinity;
    for (const v of image.data) {
        if (v < min)
            min = v;
        if (v > max)
            max = v;
    }
    const range = max - min;
    return range < 1e-8 ? mapChannel(image, () => 0.5) : mapChannel(image, (v) => (v - min) / range);
}
/** Elementwise product -- require agreement between "suppress here" maps. */
function multiplyChannels(images) {
    return combineChannels(images, (values) => values.reduce((acc, v) => acc * v, 1));
}
/** Weighted sum, renormalized so weights need not sum to 1. */
function blendChannels(entries) {
    const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0) || 1;
    return combineChannels(entries.map((e) => e.map), (values) => values.reduce((sum, v, i) => sum + v * entries[i].weight, 0) / totalWeight);
}
//# sourceMappingURL=channel-map-ops.js.map