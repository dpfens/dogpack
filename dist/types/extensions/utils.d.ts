import type { ChannelImage } from "../types";
import type { RGBImage } from "./base";
/**
 * Convert ImageData to RGBImage
 */
export declare function imageDataToRGB(imageData: ImageData): RGBImage;
/**
 * Convert RGBImage to ImageData
 */
export declare function rgbToImageData(rgb: RGBImage): ImageData;
/**
 * Convert grayscale to RGB (same value in all channels)
 */
export declare function grayscaleToRGB(gray: ChannelImage): RGBImage;
/**
 * Convert RGB to grayscale using luminance formula
 */
export declare function rgbToGrayscale(rgb: RGBImage): ChannelImage;
//# sourceMappingURL=utils.d.ts.map