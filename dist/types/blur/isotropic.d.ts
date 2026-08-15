/**
 * Blur strategies for DoG processing
 *
 * Provides both isotropic (standard) and anisotropic (flow-guided) blur
 * implementations for use in XDoG and FDoG pipelines.
 *
 * Supports parallel/concurrent blur operations
 */
import type { BlurStrategy, ChannelImage, IsotropicBlurConfig } from '../interfaces/base.js';
/**
 * Backend-agnostic isotropic blur. Picks the best backend this device
 * actually supports for *this algorithm* (not a global session-wide
 * choice), and falls back to the next-best backend if the active one
 * fails mid-session (lost context, driver crash, etc.).
 *
 * Construction is async (`IsotropicBlur.create()`) because backend
 * detection is inherently async; constructors can't be async, so a
 * private constructor plus a static factory forces detection to
 * complete before the instance is usable.
 */
export declare class IsotropicBlur implements BlurStrategy {
    private filter;
    private constructor();
    static create(config?: Partial<IsotropicBlurConfig>): Promise<IsotropicBlur>;
    get backend(): "cpu" | "webgl" | "webgpu";
    dispose(): void;
    blur(input: ChannelImage, sigma: number): Promise<ChannelImage>;
}
//# sourceMappingURL=isotropic.d.ts.map