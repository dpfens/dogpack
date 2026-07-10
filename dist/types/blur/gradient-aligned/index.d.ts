import type { BlurStrategy, ChannelImage, FlowField, GradientAlignedBlurConfig } from "../../types.js";
export type GradientAlignedBackend = 'webgpu' | 'webgl' | 'cpu';
export declare class GradientAlignedBlur implements BlurStrategy {
    private flowField;
    private config;
    private instance;
    private backend;
    private initPromise;
    constructor(flowField: FlowField, config?: Partial<GradientAlignedBlurConfig>);
    /**
     * Preferred construction path — resolves only once backend detection has
     * finished, so `getBackend()` is meaningful immediately.
     */
    static create(flowField: FlowField, config?: Partial<GradientAlignedBlurConfig>): Promise<GradientAlignedBlur>;
    /** Resolves once GPU backend detection/initialization has settled (including CPU fallback). */
    ready(): Promise<void>;
    getBackend(): GradientAlignedBackend;
    private upgradeBackend;
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    setFlowField(flowField: FlowField): void;
    dispose(): void;
}
//# sourceMappingURL=index.d.ts.map