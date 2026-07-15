/**
 * WebGL2-accelerated gradient-aligned blur for FDoG
 *
 * Runs the exact same perpendicular-to-flow sampling as
 * CPUGradientAlignedBlur, but as a single fullscreen-quad fragment shader
 * pass on the GPU instead of a per-pixel JS loop.
 *
 */
import { type BlurStrategy, type ChannelImage, type FlowField, type GradientAlignedBlurBackendConfig } from '../../interfaces/base.js';
export declare class WebGLGradientAlignedBlur implements BlurStrategy {
    readonly backend: "webgl";
    private config;
    private gl;
    private canvas;
    private program;
    private vao;
    private inputTexture;
    private flowTexture;
    private flowFieldWidth;
    private flowFieldHeight;
    private flowDirty;
    private fbo;
    private outputTexture;
    private fboWidth;
    private fboHeight;
    private uniforms;
    private contextLost;
    private flowField;
    constructor(config: GradientAlignedBlurBackendConfig);
    /**
     * Cheap synchronous-capability probe wrapped in an async signature to
     * match `BlurStrategyCtor`. Doesn't touch the instance — creates its own
     * throwaway canvas/context, same as the constructor does for real, so a
     * `true` here means "constructing an instance should work", not a
     * guarantee (construction can still fail — see key decisions in the
     * design doc on why we still try/catch `new Ctor(...)`).
     */
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): Promise<string | undefined>;
    private setupTextureParams;
    setFlowField(flowField: FlowField): void;
    dispose(): void;
    private ensureFbo;
    private bakeFlowTexture;
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
}
//# sourceMappingURL=webgl.d.ts.map