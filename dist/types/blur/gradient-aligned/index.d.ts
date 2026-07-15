import type { BlurStrategy, ChannelImage, FlowField, GradientAlignedBlurConfig } from '../../interfaces/base.js';
export declare class GradientAlignedBlur implements BlurStrategy {
    private instance;
    private currentCtor;
    private flowField;
    private config;
    private failedBackends;
    private constructor();
    private static readonly candidates;
    static create(flowField: FlowField, config?: Partial<GradientAlignedBlurConfig>): Promise<GradientAlignedBlur>;
    get backend(): "cpu" | "webgl" | "webgpu";
    dispose(): void;
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
    /**
     * Propagates to whatever backend is currently running, and is also
     * remembered for any future backend constructed by demoteAndFindNext()
     * (fallback instances are built fresh via `new Ctor(config)`, so the
     * current flow field has to be threaded through `config` each time
     * rather than mutated on an existing instance).
     */
    setFlowField(flowField: FlowField): void;
    private demoteAndFindNext;
}
//# sourceMappingURL=index.d.ts.map