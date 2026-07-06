"use strict";
// =============================================================================
// Utility Functions
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.imageDataToRGB = imageDataToRGB;
exports.rgbToImageData = rgbToImageData;
exports.grayscaleToRGB = grayscaleToRGB;
exports.rgbToGrayscale = rgbToGrayscale;
const utils_1 = require("../utils");
/**
 * Convert ImageData to RGBImage
 */
function imageDataToRGB(imageData) {
    const { width, height } = imageData;
    const size = width * height;
    const rgb = {
        r: new Float32Array(size),
        g: new Float32Array(size),
        b: new Float32Array(size),
        width,
        height,
    };
    for (let i = 0; i < size; i++) {
        rgb.r[i] = imageData.data[i * 4] / 255;
        rgb.g[i] = imageData.data[i * 4 + 1] / 255;
        rgb.b[i] = imageData.data[i * 4 + 2] / 255;
    }
    return rgb;
}
/**
 * Convert RGBImage to ImageData
 */
function rgbToImageData(rgb) {
    const { width, height } = rgb;
    const imageData = new ImageData(width, height);
    const size = width * height;
    for (let i = 0; i < size; i++) {
        imageData.data[i * 4] = Math.round(Math.max(0, Math.min(255, rgb.r[i] * 255)));
        imageData.data[i * 4 + 1] = Math.round(Math.max(0, Math.min(255, rgb.g[i] * 255)));
        imageData.data[i * 4 + 2] = Math.round(Math.max(0, Math.min(255, rgb.b[i] * 255)));
        imageData.data[i * 4 + 3] = 255;
    }
    return imageData;
}
/**
 * Convert grayscale to RGB (same value in all channels)
 */
function grayscaleToRGB(gray) {
    return {
        r: new Float32Array(gray.data),
        g: new Float32Array(gray.data),
        b: new Float32Array(gray.data),
        width: gray.width,
        height: gray.height,
    };
}
/**
 * Convert RGB to grayscale using luminance formula
 */
function rgbToGrayscale(rgb) {
    const { width, height } = rgb;
    const gray = (0, utils_1.createChannelImage)(width, height);
    for (let i = 0; i < width * height; i++) {
        gray.data[i] = 0.299 * rgb.r[i] + 0.587 * rgb.g[i] + 0.114 * rgb.b[i];
    }
    return gray;
}
//# sourceMappingURL=utils.js.map