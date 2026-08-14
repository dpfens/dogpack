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