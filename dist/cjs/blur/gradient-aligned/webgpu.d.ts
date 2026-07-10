/**
 * WebGPU-accelerated gradient-aligned blur for FDoG
 *
 * Compute-shader version of the same perpendicular-to-flow sampling as
 * CPUGradientAlignedBlur / WebGLGradientAlignedBlur. Prefer this backend
 * when available — no readback-forced sync via drawing, explicit control
 * over the copy timeline, and generally faster on the same hardware.
 *
 * ASSUMPTIONS — same as the WebGL file:
 * - `FlowField` only exposes `getTangent(x, y): Vec2`; we bake perpendicular
 *   direction into an rg32float texture once per FlowField instance.
 * - `ChannelImage.data` is a single-channel Float32Array, row-major.
 *
 * TYPES: this file assumes `@webgpu/types` is installed (or `lib.dom` in a
 * recent TS/tsconfig that includes WebGPU types). If GPUDevice/GPUBuffer
 * etc. aren't recognized, add `@webgpu/types` as a devDependency and either
 * add it to tsconfig `types`, or drop a `/// <reference types="@webgpu/types" />`
 * at the top of this file.
 *
 * NOTE ON TIMING:
 * Like the WebGL version, `queue.submit()` doesn't block — the actual GPU
 * wait happens at `mapAsync()`. So "Dispatch" below measures submission
 * only; "Readback" is where the real cost will show up. For true GPU-side
 * timing, add a `GPUQuerySet` with 'timestamp' queries around the compute
 * pass (needs the 'timestamp-query' feature) — can wire that in if you
 * want harder numbers than JS-side wall time.
 */
import { type BlurStrategy, type ChannelImage, type FlowField, type GradientAlignedBlurConfig } from '../../types.js';
export declare class WebGPUGradientAlignedBlur implements BlurStrategy {
    private flowField;
    private config;
    private device;
    private pipeline;
    private flowTexture;
    private flowFieldWidth;
    private flowFieldHeight;
    private flowDirty;
    private flowBakePromise;
    private maxTileBytes;
    private static readonly CPU_BAKE_ROWS_PER_CHUNK;
    private static readonly TILE_MEMORY_SAFETY_FACTOR;
    private constructor();
    /** WebGPU device creation is async, so use this instead of `new`. */
    static create(flowField: FlowField, config?: Partial<GradientAlignedBlurConfig>): Promise<WebGPUGradientAlignedBlur>;
    private initPipeline;
    setFlowField(flowField: FlowField): void;
    private assertWithinTextureLimits;
    /**
     * NOTE: only safe to call once no `blur()` calls are in flight — it
     * destroys the device itself, which would invalidate any in-progress
     * GPU work. Per-call buffers/textures created inside blur() are already
     * cleaned up in their own try/finally, so there's nothing else to
     * release here besides the flow texture and the device.
     */
    dispose(): void;
    private bakeFlowTexture;
    /**
     * Returns the current flow texture for (width, height), baking it if
     * necessary. Guarded so that concurrent blur() calls with matching
     * dimensions await a single in-flight bake instead of each triggering
     * their own (which would otherwise race on `this.flowTexture`).
     */
    private getFlowTexture;
    /**
     * Safe to call concurrently on the same instance (e.g.
     * `Promise.all([blur.blur(input, s1), blur.blur(input, s2)])`).
     * All GPU resources that are written-then-read per invocation are
     * allocated fresh here and destroyed before returning, so overlapping
     * calls never share mutable state. The only cross-call state is the
     * (read-only, cached) flow texture, obtained via `getFlowTexture`,
     * which is itself lock-guarded against concurrent re-baking.
     *
     * MEMORY: the output/readback path is processed in row-band tiles
     * bounded by `maxTileBytes`, not one whole-image buffer. This is what
     * keeps memory flat for large images (and for concurrent calls on the
     * same image) instead of scaling linearly with width*height — see the
     * note above `maxTileBytes` for why. The input/flow textures are still
     * one full-image texture each; if width or height exceeds the device's
     * maxTextureDimension2D, `getFlowTexture`/this method throw a clear
     * error rather than silently corrupting or crashing (see
     * `assertWithinTextureLimits`).
     */
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
}
//# sourceMappingURL=webgpu.d.ts.map