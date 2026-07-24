"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeVec2 = normalizeVec2;
exports.dotVec2 = dotVec2;
exports.perpendicular = perpendicular;
exports.generateGaussianKernel = generateGaussianKernel;
exports.clamp = clamp;
exports.lerp = lerp;
/**
 * Normalize a 2D vector
 */
function normalizeVec2(v) {
    const len = Math.sqrt(v.x * v.x + v.y * v.y);
    if (len < 1e-10) {
        return { x: 0, y: 0 };
    }
    return { x: v.x / len, y: v.y / len };
}
/**
 * Compute dot product of two vectors
 */
function dotVec2(a, b) {
    return a.x * b.x + a.y * b.y;
}
/**
 * Rotate vector 90 degrees counter-clockwise (perpendicular)
 */
function perpendicular(v) {
    return { x: -v.y, y: v.x };
}
/**
 * Generate 1D Gaussian kernel
 * @param sigma Standard deviation
 * @param size Kernel size (should be odd)
 * @returns Normalized Gaussian kernel
 */
function generateGaussianKernel(sigma, size) {
    const kernel = new Float32Array(size);
    const center = Math.floor(size / 2);
    const sigma2 = 2 * sigma * sigma;
    let sum = 0;
    for (let i = 0; i < size; i++) {
        const x = i - center;
        kernel[i] = Math.exp(-(x * x) / sigma2);
        sum += kernel[i];
    }
    // Normalize
    for (let i = 0; i < size; i++) {
        kernel[i] /= sum;
    }
    return kernel;
}
/**
 * Clamp a value to a range
 */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
/**
 * Linear interpolation
 */
function lerp(a, b, t) {
    return a + (b - a) * t;
}
//# sourceMappingURL=math.js.map