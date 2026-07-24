import type { Vec2 } from "../interfaces/base.js";

/**
 * Normalize a 2D vector
 */
export function normalizeVec2(v: Vec2): Vec2 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len < 1e-10) {
    return { x: 0, y: 0 };
  }
  return { x: v.x / len, y: v.y / len };
}

/**
 * Compute dot product of two vectors
 */
export function dotVec2(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * Rotate vector 90 degrees counter-clockwise (perpendicular)
 */
export function perpendicular(v: Vec2): Vec2 {
  return { x: -v.y, y: v.x };
}

/**
 * Generate 1D Gaussian kernel
 * @param sigma Standard deviation
 * @param size Kernel size (should be odd)
 * @returns Normalized Gaussian kernel
 */
export function generateGaussianKernel(sigma: number, size: number): Float32Array {
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
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

