/**
 * Color space conversion utilities
 *
 * Responsible for turning an RGBImage into a set of independent
 * ChannelImage instances, either as raw RGB channels or as CIE Lab
 * channels (L, a, b). Kept separate from the ETF/structure-tensor math
 * so that flow.ts stays focused purely on the Di Zenzo / eigen-decomposition
 * pipeline and doesn't need to know anything about color science.
 */
import type { ChannelImage, RGBImage } from '../interfaces/base.js';
/**
 * Which color space to decompose an RGBImage into before computing
 * a multi-channel Edge Tangent Flow.
 */
export type ColorSpace = 'rgb' | 'lab';
/**
 * Split an interleaved RGBImage into three independent ChannelImages,
 * one per channel, each still in 0-1 range.
 */
export declare function splitRGBChannels(rgb: RGBImage): [ChannelImage, ChannelImage, ChannelImage];
/**
 * Convert an interleaved RGBImage into three independent ChannelImages
 * representing CIE Lab's L, a, and b components.
 *
 * L is normalized from its native [0, 100] range to [0, 1] by dividing by 100.
 * a and b are normalized from their native (roughly [-128, 127]) range to
 * [0, 1] via (v + 128) / 255.
 *
 * This normalization is a deliberate choice: it keeps all three channels in
 * comparable numeric ranges before gradients/tensors are computed, so that
 * chroma channels don't dominate or get drowned out purely due to differing
 * native scales relative to L. Input RGB is assumed to be sRGB with values
 * in [0, 1].
 */
export declare function rgbToLabChannels(rgb: RGBImage): [ChannelImage, ChannelImage, ChannelImage];
/**
 * Convert a single sRGB pixel (each component in [0, 1]) to CIE Lab
 * (D65 white point). L is in [0, 100]; a and b are roughly in [-128, 127]
 * but are not hard-clamped.
 */
export declare function srgbToLab(r: number, g: number, b: number): [number, number, number];
//# sourceMappingURL=color.d.ts.map