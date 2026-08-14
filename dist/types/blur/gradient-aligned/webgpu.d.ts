/**
 * WebGPU-accelerated gradient-aligned blur for FDoG
 *
 * Compute-shader version of the same perpendicular-to-flow sampling as
 * CPUGradientAlignedBlur / WebGLGradientAlignedBlur.
 *
 */
import { type BlurStrategy, type ChannelImage, type FlowField, type GradientAlignedBlurBackendConfig } from '../../interfaces/base.js';
export declare class WebGPUGradientAlignedBlur implements BlurStrategy {
    readonly backend: "webgpu";
    private config;
    private device;
    private pipeline;
    private flowField;
    private static cachedDevice;
    private static deviceInitPromise;
    private static lastUnsupportedReason;
    private static errorListenerAttached;
    private flowTexture;
    private flowFieldWidth;
    private flowFieldHeight;
    private flowDirty;
    private flowBakePromise;
    private maxTileBytes;
    private static readonly CPU_BAKE_ROWS_PER_CHUNK;
    private static readonly TILE_MEMORY_SAFETY_FACTOR;
    constructor(config: GradientAlignedBlurBackendConfig);
    /**
     * Acquires (and caches) the shared GPUDevice. Concurrent callers await
     * the same in-flight request rather than each requesting their own
     * adapter/device. Re-acquires automatically after a `device.lost` clears
     * the cache.
     */
    private static acquireDevice;
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): string | undefined;
    private initPipeline;
    setFlowField(flowField: FlowField): void;
    private assertWithinTextureLimits;
    /**
     * Releases this instance's own GPU resources (flow texture). Deliberately
     * does NOT destroy `this.device`. The device is shared/cached at the
     * class level (see file header), and other instances (or a future
     * instance created after a fallback-and-retry) may still be using it.
     * If you need to fully release the device (e.g. on app shutdown), that's
     * out of scope for a per-instance dispose() and would need an explicit
     * class-level teardown method instead.
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
     * same image) instead of scaling linearly with width*height.
     * The input/flow textures are still
     * one full-image texture each; if width or height exceeds the device's
     * maxTextureDimension2D, `getFlowTexture`/this method throw a clear
     * error rather than silently corrupting or crashing (see
     * `assertWithinTextureLimits`).
     */
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
}
//# sourceMappingURL=webgpu.d.ts.map