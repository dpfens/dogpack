/**
 * Image utility functions
 */

import { GrayscaleImage, RGBImage, Vec2 } from './types.js';

/**
 * Create a new grayscale image with given dimensions
 */
export function createGrayscaleImage(width: number, height: number): GrayscaleImage {
  return {
    data: new Float32Array(width * height),
    width,
    height,
  };
}

/**
 * Clone a grayscale image
 */
export function cloneGrayscaleImage(image: GrayscaleImage): GrayscaleImage {
  return {
    data: new Float32Array(image.data),
    width: image.width,
    height: image.height,
  };
}

/**
 * Get pixel value with bounds checking (clamps to edge)
 */
export function getPixel(image: GrayscaleImage, x: number, y: number): number {
  const clampedX = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
  const clampedY = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
  return image.data[clampedY * image.width + clampedX];
}

/**
 * Set pixel value
 */
export function setPixel(image: GrayscaleImage, x: number, y: number, value: number): void {
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
export function rgbToGrayscale(rgb: RGBImage): GrayscaleImage {
  const gray = createGrayscaleImage(rgb.width, rgb.height);
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
export function imageDataToGrayscale(imageData: ImageData): GrayscaleImage {
  const gray = createGrayscaleImage(imageData.width, imageData.height);
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
export function grayscaleToImageData(gray: GrayscaleImage): ImageData {
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
 * Rotate vector 90 degrees counter-clockwise
 */
export function perpendicular(v: Vec2): Vec2 {
  return { x: -v.y, y: v.x };
}
