/**
 * Gradient-aligned blur for FDoG
 *
 * This applies blur perpendicular to the flow direction (across edges).
 * Used for the DoG computation in FDoG, where we want to blur across
 * edges but not along them.
 */
import type { BlurStrategy, ChannelImage, FlowField } from '../types.js';
import { BaseCPUBlur } from './base.js';
/**
 * Configuration for flow-guided blur
 */
export interface GradientAlignedBlurConfig {
    /**
     * Kernel size multiplier for flow-aligned LIC (default: 6)
     */
    kernelSizeMultiplier: number;
    /**
     * Step size for line integral convolution (default: 1.0)
     * Smaller values give smoother integration but cost more
     */
    stepSize: number;
}
export declare class CPUGradientAlignedBlur extends BaseCPUBlur implements BlurStrategy {
    private flowField;
    private config;
    constructor(flowField: FlowField, config?: Partial<GradientAlignedBlurConfig>);
    dispose(): void;
    setFlowField(flowField: FlowField): void;
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    /**
     * Sample perpendicular to the flow direction
     */
    private sampleAcrossFlow;
}
export declare class GradientAlignedBlur implements BlurStrategy {
    private instance;
    constructor(flowField: FlowField, config?: Partial<GradientAlignedBlurConfig>);
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    setFlowField(flowField: FlowField): void;
    dispose(): void;
}
//# sourceMappingURL=gradient-aligned.d.ts.map