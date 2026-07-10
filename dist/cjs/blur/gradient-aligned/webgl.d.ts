/**
 * WebGL2-accelerated gradient-aligned blur for FDoG
 *
 * Runs the exact same perpendicular-to-flow sampling as
 * CPUGradientAlignedBlur, but as a single fullscreen-quad fragment shader
 * pass on the GPU instead of a per-pixel JS loop.
 *
 * ASSUMPTIONS (double check against your real types.ts):
 * - `FlowField` only exposes `getTangent(x, y): Vec2` — there's no bulk
 *   accessor. So we "bake" the perpendicular direction into an RG32F
 *   texture once per FlowField (cached; only rebaked when setFlowField()
 *   is called or the image dimensions change). If FlowField ever grows a
 *   bulk method (e.g. a Float32Array of tangents), swap bakeFlowTexture()
 *   to use it directly and skip the per-pixel getTangent() calls.
 * - `ChannelImage.data` is a single-channel Float32Array, row-major.
 * - `BlurStrategy` is `{ blur(input, sigma): Promise<ChannelImage> }`.
 *
 * NOTE ON THE TIMING NUMBERS:
 * WebGL submission (drawArrays) is async on the GPU timeline. The
 * "Draw call" log below only measures how long it took the JS thread to
 * *submit* the work — the driver doesn't actually block until something
 * forces a sync, which here is `readPixels`. So in practice most of the
 * real GPU time will show up under "Readback", not "Draw call". If you
 * need true GPU-side timing, add the EXT_disjoint_timer_query_webgl2
 * extension — happy to wire that in if these numbers don't add up.
 */
import { type BlurStrategy, type ChannelImage, type FlowField, type GradientAlignedBlurConfig } from '../../types.js';
export declare class WebGLGradientAlignedBlur implements BlurStrategy {
    private flowField;
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
    constructor(flowField: FlowField, config?: Partial<GradientAlignedBlurConfig>);
    private setupTextureParams;
    setFlowField(flowField: FlowField): void;
    dispose(): void;
    private ensureFbo;
    private bakeFlowTexture;
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
}
//# sourceMappingURL=webgl.d.ts.map