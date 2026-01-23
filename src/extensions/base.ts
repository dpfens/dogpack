import { 
  GrayscaleImage, 
} from '../types.js';
import { EdgeTangentFlow } from '../etf/index.js';

// =============================================================================
// Core Types
// =============================================================================

/**
 * Base interface for all extension strategies
 */
export interface ExtensionStrategy<TConfig, TInput, TOutput> {
  apply(input: TInput, config?: Partial<TConfig>): Promise<TOutput>;
}

/**
 * RGB image representation for color operations
 */
export interface RGBImage {
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  width: number;
  height: number;
}

/**
 * Result from a DoG processor (either XDoG or FDoG)
 */
export interface DoGResult {
  /** The final processed image */
  image: GrayscaleImage;
  /** The sharpened image before thresholding (if available) */
  sharpened?: GrayscaleImage;
  /** Edge tangent flow (only from FDoG) */
  etf?: EdgeTangentFlow;
  /** The original grayscale input */
  originalGray?: GrayscaleImage;
  /** The original color input (if provided) */
  originalColor?: RGBImage;
}