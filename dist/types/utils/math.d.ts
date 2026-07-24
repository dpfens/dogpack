import type { Vec2 } from "../interfaces/base.js";
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
 * Clamp a value to a range
 */
export declare function clamp(value: number, min: number, max: number): number;
/**
 * Linear interpolation
 */
export declare function lerp(a: number, b: number, t: number): number;
//# sourceMappingURL=math.d.ts.map