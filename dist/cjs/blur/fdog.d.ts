import type { BlurStrategy, ChannelImage, FlowField } from '../types';
import { type FlowGuidedBlurConfig } from './flow-guided';
export declare class FDoGBlur implements BlurStrategy {
    private gradientBlur;
    private flowBlur;
    private sigmaM;
    static isSupported(): boolean;
    static getUnsupportedReason(): string | undefined;
    /**
     * @param flowField Edge tangent flow field
     * @param sigmaM Flow-aligned smoothing sigma (σm from paper)
     * @param config Additional configuration
     */
    constructor(flowField: FlowField, sigmaM: number, config?: Partial<FlowGuidedBlurConfig>);
    dispose(): void;
    setFlowField(flowField: FlowField): void;
    setSigmaM(sigmaM: number): void;
    /**
     * Apply the two-pass FDoG blur
     * @param input Source image
     * @param sigma Edge detection sigma (σe) - applied perpendicular to edges
     */
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    /**
     * Apply only gradient-aligned blur (for DoG computation)
     */
    blurGradientAligned(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    /**
     * Apply only flow-aligned blur (for post-processing/anti-aliasing)
     */
    blurFlowAligned(input: ChannelImage, sigma: number): Promise<ChannelImage>;
}
//# sourceMappingURL=fdog.d.ts.map