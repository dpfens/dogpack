import type { ChannelImage, RGBImage } from '../interfaces/base.js';
/**
 * Create a new grayscale image with given dimensions
 */
export declare function createChannelImage(width: number, height: number): ChannelImage;
/**
 * Clone a grayscale image
 */
export declare function cloneChannelImage(image: ChannelImage): ChannelImage;
/**
 * Get pixel value with bounds checking (clamps to edge)
 */
export declare function getPixel(image: ChannelImage, x: number, y: number): number;
/**
 * Get pixel value with bilinear interpolation for sub-pixel sampling
 */
export declare function getPixelBilinear(image: ChannelImage, x: number, y: number): number;
/**
 * Set pixel value
 */
export declare function setPixel(image: ChannelImage, x: number, y: number, value: number): void;
/**
 * Get pixel index for coordinates
 */
export declare function getIndex(width: number, x: number, y: number): number;
/**
 * Convert RGB image to grayscale using luminance formula
 */
export declare function rgbToGrayscale(rgb: RGBImage): ChannelImage;
/**
 * Convert ImageData (from canvas) to grayscale image
 * Assumes values are in 0-255 range, normalizes to 0-1
 */
export declare function imageDataToLuminance(imageData: ImageData): ChannelImage;
/**
 * Convert grayscale image to ImageData (for canvas display)
 * Assumes input is in 0-1 range
 *
 * @param alpha Optional per-pixel alpha (0-255), one entry per pixel in
 * the same row-major order as `gray.data`. Omit to get a fully opaque
 * image (alpha = 255 everywhere), which matches this function's original
 * behavior for callers that don't care about transparency.
 */
export declare function luminanceToImageData(gray: ChannelImage, alpha?: Uint8ClampedArray): ImageData;
//# sourceMappingURL=image.d.ts.map