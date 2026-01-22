/**
 * Image utility functions
 */
import { GrayscaleImage, RGBImage, Vec2 } from '../types.js';
/**
 * Create a new grayscale image with given dimensions
 */
export declare function createGrayscaleImage(width: number, height: number): GrayscaleImage;
/**
 * Clone a grayscale image
 */
export declare function cloneGrayscaleImage(image: GrayscaleImage): GrayscaleImage;
/**
 * Get pixel value with bounds checking (clamps to edge)
 */
export declare function getPixel(image: GrayscaleImage, x: number, y: number): number;
/**
 * Get pixel value with bilinear interpolation for sub-pixel sampling
 */
export declare function getPixelBilinear(image: GrayscaleImage, x: number, y: number): number;
/**
 * Set pixel value
 */
export declare function setPixel(image: GrayscaleImage, x: number, y: number, value: number): void;
/**
 * Get pixel index for coordinates
 */
export declare function getIndex(width: number, x: number, y: number): number;
/**
 * Convert RGB image to grayscale using luminance formula
 */
export declare function rgbToGrayscale(rgb: RGBImage): GrayscaleImage;
/**
 * Convert ImageData (from canvas) to grayscale image
 * Assumes values are in 0-255 range, normalizes to 0-1
 */
export declare function imageDataToGrayscale(imageData: ImageData): GrayscaleImage;
/**
 * Convert grayscale image to ImageData (for canvas display)
 * Assumes input is in 0-1 range
 */
export declare function grayscaleToImageData(gray: GrayscaleImage): ImageData;
/**
 * Normalize a 2D vector
 */
export declare function normalizeVec2(v: Vec2): Vec2;
/**
 * Compute dot product of two vectors
 */
export declare function dotVec2(a: Vec2, b: Vec2): number;
/**
 * Rotate vector 90 degrees counter-clockwise (perpendicular)
 */
export declare function perpendicular(v: Vec2): Vec2;
/**
 * Generate 1D Gaussian kernel
 * @param sigma Standard deviation
 * @param size Kernel size (should be odd)
 * @returns Normalized Gaussian kernel
 */
export declare function generateGaussianKernel(sigma: number, size: number): Float32Array;
/**
 * Compute kernel size from sigma
 * Paper samples at all integer locations less than 2× sigma for flow-aligned,
 * and extends to 2.45σ for structure tensor blur
 *
 * @param sigma Standard deviation
 * @param multiplier Size multiplier (default 6 = 3σ on each side)
 */
export declare function computeKernelSize(sigma: number, multiplier?: number): number;
/**
 * Clamp a value to a range
 */
export declare function clamp(value: number, min: number, max: number): number;
/**
 * Linear interpolation
 */
export declare function lerp(a: number, b: number, t: number): number;
//# sourceMappingURL=index.d.ts.map