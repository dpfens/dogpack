/**
 * Elementwise composition primitives for parameter maps (ChannelImage
 * used as p / epsilon / phi overrides in DoGConfig).
 */
import type { ChannelImage } from '../interfaces/base.js';
export declare function mapChannel(image: ChannelImage, fn: (value: number, index: number) => number): ChannelImage;
export declare function combineChannels(images: ChannelImage[], fn: (values: number[], index: number) => number): ChannelImage;
export declare function constantChannel(value: number, like: ChannelImage): ChannelImage;
/** low where weight=0, high where weight=1. Any of the three may be a plain number. */
export declare function lerpChannel(low: ChannelImage | number, high: ChannelImage | number, weight: ChannelImage | number): ChannelImage;
export declare function normalizeChannel(image: ChannelImage): ChannelImage;
/** Elementwise product -- require agreement between "suppress here" maps. */
export declare function multiplyChannels(images: ChannelImage[]): ChannelImage;
/** Weighted sum, renormalized so weights need not sum to 1. */
export declare function blendChannels(entries: Array<{
    map: ChannelImage;
    weight: number;
}>): ChannelImage;
//# sourceMappingURL=channel-map-ops.d.ts.map