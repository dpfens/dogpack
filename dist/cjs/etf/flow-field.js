"use strict";
/**
 * Shared FlowField result type for Edge Tangent Flow backends.
 *
 * Every ETFComputer backend (CPU, WebGPU, WebGL, ...) ends up with the
 * same thing: a per-pixel unit tangent vector field plus width/height.
 * The only thing that differs between backends is how that field arrives
 * — the CPU backend naturally produces an array of Vec2 objects (the
 * eigen-math is inherently per-pixel), while GPU backends read back a
 * flat Float32Array from a storage buffer and would rather not allocate
 * a pixel-count of JS objects while doing it. TangentFlowField accepts
 * either via its two factory functions and stores tangents as a flat
 * stride-2 Float32Array either way, so getTangent/getTangentArray/
 * visualize/visualizeColor are implemented exactly once.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TangentFlowField = void 0;
const index_js_1 = require("../utils/index.js");
class TangentFlowField {
    tangents;
    width;
    height;
    // Flat, stride-2 (x, y) buffer — avoids allocating pixelCount JS
    // objects regardless of which backend produced the data.
    constructor(tangents, width, height) {
        this.tangents = tangents;
        this.width = width;
        this.height = height;
    }
    /**
     * Construct from a flat stride-2 Float32Array, e.g. a GPU buffer
     * readback. Takes ownership of the array — callers should not mutate
     * it afterward.
     */
    static fromFloat32Array(tangents, width, height) {
        return new TangentFlowField(tangents, width, height);
    }
    /**
     * Construct from a per-pixel Vec2 array, e.g. the output of a CPU
     * eigendecomposition pipeline. Copies into a flat stride-2 layout.
     */
    static fromVec2Array(tangents, width, height) {
        const flat = new Float32Array(tangents.length * 2);
        for (let i = 0; i < tangents.length; i++) {
            flat[i * 2] = tangents[i].x;
            flat[i * 2 + 1] = tangents[i].y;
        }
        return new TangentFlowField(flat, width, height);
    }
    getTangent(x, y) {
        const clampedX = Math.max(0, Math.min(this.width - 1, Math.round(x)));
        const clampedY = Math.max(0, Math.min(this.height - 1, Math.round(y)));
        const idx = (clampedY * this.width + clampedX) * 2;
        return { x: this.tangents[idx], y: this.tangents[idx + 1] };
    }
    /**
     * Get all tangents as a flat array (for GPU upload). Returns a copy so
     * callers can't mutate internal state out from under us.
     */
    getTangentArray() {
        return this.tangents.slice();
    }
    /**
     * Visualize the flow field as a grayscale image.
     * Encodes direction as intensity (useful for debugging).
     */
    visualize() {
        const output = (0, index_js_1.createChannelImage)(this.width, this.height);
        for (let i = 0; i < this.width * this.height; i++) {
            const tx = this.tangents[i * 2];
            const ty = this.tangents[i * 2 + 1];
            const angle = Math.atan2(ty, tx);
            output.data[i] = (angle + Math.PI) / (2 * Math.PI);
        }
        return output;
    }
    /**
     * Visualize as a color image (HSV with direction as hue).
     */
    visualizeColor() {
        const imageData = new ImageData(this.width, this.height);
        for (let i = 0; i < this.width * this.height; i++) {
            const tx = this.tangents[i * 2];
            const ty = this.tangents[i * 2 + 1];
            // Direction as hue
            const angle = Math.atan2(ty, tx);
            const hue = (angle + Math.PI) / (2 * Math.PI);
            // Magnitude as saturation/value (always 1 for normalized vectors)
            const [r, g, b] = hsvToRgb(hue, 1, 1);
            const o = i * 4;
            imageData.data[o] = r;
            imageData.data[o + 1] = g;
            imageData.data[o + 2] = b;
            imageData.data[o + 3] = 255;
        }
        return imageData;
    }
}
exports.TangentFlowField = TangentFlowField;
/**
 * Convert HSV to RGB. Only used by visualizeColor() above.
 */
function hsvToRgb(h, s, v) {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    let r, g, b;
    switch (i % 6) {
        case 0:
            r = v;
            g = t;
            b = p;
            break;
        case 1:
            r = q;
            g = v;
            b = p;
            break;
        case 2:
            r = p;
            g = v;
            b = t;
            break;
        case 3:
            r = p;
            g = q;
            b = v;
            break;
        case 4:
            r = t;
            g = p;
            b = v;
            break;
        case 5:
            r = v;
            g = p;
            b = q;
            break;
        default:
            r = 0;
            g = 0;
            b = 0;
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
//# sourceMappingURL=flow-field.js.map