import type { BlurStrategy, ChannelImage, FlowField, GradientAlignedBlurConfig } from "../../types.js";
import { isWebGLComputeSupported, isWebGPUSupported } from "../../utils/index.js";
import { CPUGradientAlignedBlur } from "./cpu.js";
import { WebGLGradientAlignedBlur } from "./webgl.js";
import { WebGPUGradientAlignedBlur } from "./webgpu.js";

export type GradientAlignedBackend = 'webgpu' | 'webgl' | 'cpu';
 
type BackendInstance = BlurStrategy & {
  setFlowField?(flowField: FlowField): void;
  dispose?(): void;
};
 
export class GradientAlignedBlur implements BlurStrategy {
  private instance: BackendInstance;
  private backend: GradientAlignedBackend = 'cpu';
  private initPromise: Promise<void>;
 
  constructor(
    private flowField: FlowField,
    private config: Partial<GradientAlignedBlurConfig> = {},
  ) {
    // Always start with a working CPU instance so the object is valid the
    // instant it's constructed. blur() awaits initPromise before running,
    // so no work actually happens on this instance unless backend upgrade
    // fails entirely — it's a fallback, not a "first frame is slow" thing.
    this.instance = new CPUGradientAlignedBlur(flowField, config);
    this.backend = 'cpu';
    this.initPromise = this.upgradeBackend();
  }
 
  /**
   * Preferred construction path — resolves only once backend detection has
   * finished, so `getBackend()` is meaningful immediately.
   */
  static async create(
    flowField: FlowField,
    config: Partial<GradientAlignedBlurConfig> = {},
  ): Promise<GradientAlignedBlur> {
    const instance = new GradientAlignedBlur(flowField, config);
    await instance.ready();
    return instance;
  }
 
  /** Resolves once GPU backend detection/initialization has settled (including CPU fallback). */
  ready(): Promise<void> {
    return this.initPromise;
  }
 
  getBackend(): GradientAlignedBackend {
    return this.backend;
  }
 
  private async upgradeBackend(): Promise<void> {
    const t0 = performance.now();
 
    if (await isWebGPUSupported()) {
      try {
        const gpuInstance = await WebGPUGradientAlignedBlur.create(this.flowField, this.config);
        this.instance.dispose?.();
        this.instance = gpuInstance;
        this.backend = 'webgpu';
        console.log(
          `[GradientAlignedBlur] Using WebGPU backend (init: ${(performance.now() - t0).toFixed(2)}ms)`,
        );
        return;
      } catch (err) {
        console.warn('[GradientAlignedBlur] WebGPU init failed, falling back:', err);
      }
    }
 
    if (isWebGLComputeSupported()) {
      try {
        const glInstance = new WebGLGradientAlignedBlur(this.flowField, this.config);
        this.instance.dispose?.();
        this.instance = glInstance;
        this.backend = 'webgl';
        console.log(
          `[GradientAlignedBlur] Using WebGL2 backend (init: ${(performance.now() - t0).toFixed(2)}ms)`,
        );
        return;
      } catch (err) {
        console.warn('[GradientAlignedBlur] WebGL2 init failed, falling back to CPU:', err);
      }
    }
 
    console.log(
      `[GradientAlignedBlur] Using CPU backend (fallback) (detection: ${(performance.now() - t0).toFixed(2)}ms)`,
    );
  }
 
  async blur(input: ChannelImage, sigma: number): Promise<ChannelImage> {
    await this.initPromise;
    return this.instance.blur(input, sigma);
  }
 
  setFlowField(flowField: FlowField): void {
    this.flowField = flowField;
    this.instance.setFlowField?.(flowField);
  }
 
  dispose(): void {
    this.instance.dispose?.();
  }
}