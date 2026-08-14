/**
 * Gradient-aligned blur for FDoG
 *
 * This applies blur perpendicular to the flow direction (across edges).
 * Used for the DoG computation in FDoG, where we want to blur across
 * edges but not along them.
 */
import { type BlurStrategy, type ChannelImage, type FlowField, type GradientAlignedBlurBackendConfig } from '../../interfaces/base.js';
import { BaseCPUStrategy } from '../../base.js';
export declare class CPUGradientAlignedBlur extends BaseCPUStrategy implements BlurStrategy {
    readonly backend: "cpu";
    private config;
    private flowField;
    constructor(config: GradientAlignedBlurBackendConfig);
    static isSupported(): Promise<boolean>;
    dispose(): void;
    setFlowField(flowField: FlowField): void;
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    /**
     * Sample perpendicular to the flow direction
     */
    private sampleAcrossFlow;
}
//# sourceMappingURL=cpu.d.ts.map