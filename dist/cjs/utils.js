"use strict";
/**
 * Image utility functions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createChannelImage = createChannelImage;
exports.cloneChannelImage = cloneChannelImage;
exports.getPixel = getPixel;
exports.getPixelBilinear = getPixelBilinear;
exports.setPixel = setPixel;
exports.getIndex = getIndex;
exports.rgbToGrayscale = rgbToGrayscale;
exports.imageDataToLuminance = imageDataToLuminance;
exports.luminanceToImageData = luminanceToImageData;
exports.normalizeVec2 = normalizeVec2;
exports.dotVec2 = dotVec2;
exports.perpendicular = perpendicular;
exports.generateGaussianKernel = generateGaussianKernel;
exports.computeKernelSize = computeKernelSize;
exports.clamp = clamp;
exports.lerp = lerp;
exports.at = at;
exports.tauToP = tauToP;
exports.pToTau = pToTau;
/**
 * Create a new grayscale image with given dimensions
 */
function createChannelImage(width, height) {
    return {
        data: new Float32Array(width * height),
        width,
        height,
    };
}
/**
 * Clone a grayscale image
 */
function cloneChannelImage(image) {
    return {
        data: new Float32Array(image.data),
        width: image.width,
        height: image.height,
    };
}
/**
 * Get pixel value with bounds checking (clamps to edge)
 */
function getPixel(image, x, y) {
    const clampedX = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
    const clampedY = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
    return image.data[clampedY * image.width + clampedX];
}
/**
 * Get pixel value with bilinear interpolation for sub-pixel sampling
 */
function getPixelBilinear(image, x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const fx = x - x0;
    const fy = y - y0;
    const v00 = getPixel(image, x0, y0);
    const v10 = getPixel(image, x1, y0);
    const v01 = getPixel(image, x0, y1);
    const v11 = getPixel(image, x1, y1);
    return (v00 * (1 - fx) * (1 - fy) +
        v10 * fx * (1 - fy) +
        v01 * (1 - fx) * fy +
        v11 * fx * fy);
}
/**
 * Set pixel value
 */
function setPixel(image, x, y, value) {
    if (x >= 0 && x < image.width && y >= 0 && y < image.height) {
        image.data[y * image.width + x] = value;
    }
}
/**
 * Get pixel index for coordinates
 */
function getIndex(width, x, y) {
    return y * width + x;
}
/**
 * Convert RGB image to grayscale using luminance formula
 */
function rgbToGrayscale(rgb) {
    const gray = createChannelImage(rgb.width, rgb.height);
    const pixelCount = rgb.width * rgb.height;
    for (let i = 0; i < pixelCount; i++) {
        const r = rgb.data[i * 3];
        const g = rgb.data[i * 3 + 1];
        const b = rgb.data[i * 3 + 2];
        // Standard luminance formula
        gray.data[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    return gray;
}
/**
 * Convert ImageData (from canvas) to grayscale image
 * Assumes values are in 0-255 range, normalizes to 0-1
 */
function imageDataToLuminance(imageData) {
    const gray = createChannelImage(imageData.width, imageData.height);
    const pixelCount = imageData.width * imageData.height;
    for (let i = 0; i < pixelCount; i++) {
        const r = imageData.data[i * 4] / 255;
        const g = imageData.data[i * 4 + 1] / 255;
        const b = imageData.data[i * 4 + 2] / 255;
        gray.data[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    return gray;
}
/**
 * Convert grayscale image to ImageData (for canvas display)
 * Assumes input is in 0-1 range
 */
function luminanceToImageData(gray) {
    const imageData = new ImageData(gray.width, gray.height);
    const pixelCount = gray.width * gray.height;
    for (let i = 0; i < pixelCount; i++) {
        const value = Math.max(0, Math.min(255, Math.round(gray.data[i] * 255)));
        imageData.data[i * 4] = value;
        imageData.data[i * 4 + 1] = value;
        imageData.data[i * 4 + 2] = value;
        imageData.data[i * 4 + 3] = 255;
    }
    return imageData;
}
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
 * Compute kernel size from sigma
 * Paper samples at all integer locations less than 2× sigma for flow-aligned,
 * and extends to 2.45σ for structure tensor blur
 *
 * @param sigma Standard deviation
 * @param multiplier Size multiplier (default 6 = 3σ on each side)
 */
function computeKernelSize(sigma, multiplier = 6) {
    // Ensure odd size for symmetric kernel
    return Math.max(3, Math.floor(sigma * multiplier) | 1);
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
/**
 * Reads a value that may be a scalar (uniform) or a per-pixel ChannelImage.
 */
function at(value, i) {
    return typeof value === "number" ? value : value.data[i];
}
/**
 * Convert from the original τ parameterization to the new p parameterization
 * τ = p / (p + 1), so p = τ / (1 - τ)
 */
function tauToP(tau) {
    if (tau >= 1) {
        return Infinity;
    }
    return tau / (1 - tau);
}
/**
 * Convert from p parameterization back to τ
 * p = τ / (1 - τ), so τ = p / (p + 1)
 */
function pToTau(p) {
    return p / (p + 1);
}
//# sourceMappingURL=utils.js.map