/**
 * Image utility functions
 */
import type { ChannelImage, RGBImage, Vec2 } from '../types.js';
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
 */
export declare function luminanceToImageData(gray: ChannelImage): ImageData;
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
/**
 * Reads a value that may be a scalar (uniform) or a per-pixel ChannelImage.
 */
export declare function at(value: number | ChannelImage, i: number): number;
/**
 * Sample a single value from a standard normal distribution N(0, 1)
 * using the Box-Muller transform.
 *
 * Used by ADoG's adaptive noise injection (Eq. 6): the sampled value is
 * scaled by a tone-dependent sigma(x) and added to the input luminance.
 */
export declare function gaussianSample(): number;
/**
 * Pixel-wise logical AND across N binarized (0/1) ChannelImages.
 *
 * Generalizes Eq. (7)/(9) from "Gaussian Image Binarization":
 *   HDoG = FDoG ∧ ADoG_s ∧ ADoG_s'
 *
 * Since binarized images only contain 0 or 1, logical AND is equivalent to
 * taking the minimum across images (no De Morgan's / inversion needed here
 * -- see the paper's Eq. (8) for why AND and "invert-OR-invert" coincide;
 * this just implements AND directly).
 *
 * All images must have matching dimensions; this is not checked here for
 * performance -- validate upstream if inputs could mismatch.
 */
export declare function andCombine(images: ChannelImage[]): ChannelImage;
//# sourceMappingURL=index.d.ts.map