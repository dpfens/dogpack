/**
 * Image utility functions
 */

import type { ChannelImage, RGBImage, Vec2 } from '../types.js';

/**
 * Create a new grayscale image with given dimensions
 */
export function createChannelImage(width: number, height: number): ChannelImage {
  return {
    data: new Float32Array(width * height),
    width,
    height,
  };
}

/**
 * Clone a grayscale image
 */
export function cloneChannelImage(image: ChannelImage): ChannelImage {
  return {
    data: new Float32Array(image.data),
    width: image.width,
    height: image.height,
  };
}

/**
 * Get pixel value with bounds checking (clamps to edge)
 */
export function getPixel(image: ChannelImage, x: number, y: number): number {
  const clampedX = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
  const clampedY = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
  return image.data[clampedY * image.width + clampedX];
}

/**
 * Get pixel value with bilinear interpolation for sub-pixel sampling
 */
export function getPixelBilinear(image: ChannelImage, x: number, y: number): number {
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
  
  return (
    v00 * (1 - fx) * (1 - fy) +
    v10 * fx * (1 - fy) +
    v01 * (1 - fx) * fy +
    v11 * fx * fy
  );
}

/**
 * Set pixel value
 */
export function setPixel(image: ChannelImage, x: number, y: number, value: number): void {
  if (x >= 0 && x < image.width && y >= 0 && y < image.height) {
    image.data[y * image.width + x] = value;
  }
}

/**
 * Get pixel index for coordinates
 */
export function getIndex(width: number, x: number, y: number): number {
  return y * width + x;
}

/**
 * Convert RGB image to grayscale using luminance formula
 */
export function rgbToGrayscale(rgb: RGBImage): ChannelImage {
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
export function imageDataToLuminance(imageData: ImageData): ChannelImage {
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
export function luminanceToImageData(gray: ChannelImage): ImageData {
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
 * Compute kernel size from sigma
 * Paper samples at all integer locations less than 2× sigma for flow-aligned,
 * and extends to 2.45σ for structure tensor blur
 * 
 * @param sigma Standard deviation
 * @param multiplier Size multiplier (default 6 = 3σ on each side)
 */
export function computeKernelSize(sigma: number, multiplier: number = 6): number {
  // Ensure odd size for symmetric kernel
  return Math.max(3, Math.floor(sigma * multiplier) | 1);
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



/**
 * Reads a value that may be a scalar (uniform) or a per-pixel ChannelImage.
 */
export function at(value: number | ChannelImage, i: number): number {
  return typeof value === "number" ? value : value.data[i];
}

/**
 * Sample a single value from a standard normal distribution N(0, 1)
 * using the Box-Muller transform.
 * 
 * Used by ADoG's adaptive noise injection (Eq. 6): the sampled value is
 * scaled by a tone-dependent sigma(x) and added to the input luminance.
 */
export function gaussianSample(): number {
  // Avoid Math.log(0) by excluding 0 from the uniform sample
  let u1 = 0;
  while (u1 === 0) {
    u1 = Math.random();
  }
  const u2 = Math.random();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

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
export function andCombine(images: ChannelImage[]): ChannelImage {
  if (images.length === 0) {
    throw new Error('andCombine requires at least one image');
  }

  const { width, height } = images[0];
  const output = createChannelImage(width, height);
  const size = width * height;

  for (let i = 0; i < size; i++) {
    let v = 1;
    for (const img of images) {
      v = Math.min(v, img.data[i]);
    }
    output.data[i] = v;
  }

  return output;
}

let webglComputeSupportCache: boolean | null = null;

export function isWebGLComputeSupported(): boolean {
  if (webglComputeSupportCache !== null) return webglComputeSupportCache;

  try {
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1)
        : typeof document !== 'undefined'
          ? document.createElement('canvas')
          : null;

    if (!canvas) {
      webglComputeSupportCache = false;
      return webglComputeSupportCache;
    }

    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) {
      webglComputeSupportCache = false;
      return webglComputeSupportCache;
    }

    // Exclude software rasterizers — too slow to be a useful compute fallback
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debugInfo
      ? (gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string)
      : '';
    const isSoftware = /swiftshader|software|llvmpipe/i.test(renderer);

    // Required for float render targets, used in most GPGPU-style passes
    const hasFloatTargets = gl.getExtension('EXT_color_buffer_float') !== null;

    gl.getExtension('WEBGL_lose_context')?.loseContext();

    webglComputeSupportCache = !isSoftware && hasFloatTargets;
    return webglComputeSupportCache;
  } catch {
    webglComputeSupportCache = false;
    return webglComputeSupportCache;
  }
}

export async function isWebGPUSupported(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return false;
  }
  try {
    const adapter = await (navigator as any).gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}