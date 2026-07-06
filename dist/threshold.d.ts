import { ChannelImage } from "./types.js";
export interface ThresholdStrategy {
    threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage;
}
export interface ThresholdConfig {
    epsilon: number | ChannelImage;
    phi: number | ChannelImage;
}
export declare class SoftThresholdStrategy implements ThresholdStrategy {
    threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage;
}
export declare class HysteresisThresholdStrategy implements ThresholdStrategy {
    private readonly highOffset;
    private readonly lowOffset;
    constructor(highOffset?: number, lowOffset?: number);
    threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage;
    private floodFill;
}
//# sourceMappingURL=threshold.d.ts.map