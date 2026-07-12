import type { ETFComputer, ETFConfig, FlowField, ChannelImage } from '../types.js';
import { WebGpuEdgeTangentFlowComputer } from './webgpu.js';
import { WebGLEdgeTangentFlowComputer } from './webgl.js';
import { CpuEdgeTangentFlowComputer } from './cpu.js';

export type ETFImpl = 'cpu' | 'webgl' | 'webgpu' | 'auto';

/**
 * Edge Tangent Flow computer that automatically selects the best available
 * backend implementation.
 *
 * Preference order in 'auto' mode: WebGPU > WebGL > CPU. Backend selection
 * is stateful and happens at most once per instance: the first call to
 * compute()/computeMultiChannel() probes backends (honoring `forceImpl`,
 * or falling back WebGPU -> WebGL -> CPU) and caches whichever one
 * actually works; every later call on this instance reuses that same
 * backend directly. This avoids re-attempting WebGPU/WebGL acquisition on
 * every call, and means dispose() has a single, well-defined backend
 * instance to release GPU resources from.
 */
export class EdgeTangentFlowComputer implements ETFComputer {
  private computer: ETFComputer | null = null;

  constructor(private readonly forceImpl: ETFImpl = 'auto') {}

  /**
   * Check if WebGPU acceleration is available.
   *
   * Note: this is the same cheap synchronous check WebGpuEdgeTangentFlowComputer
   * itself uses (navigator.gpu presence) — it doesn't guarantee an adapter
   * can actually be obtained. Use WebGpuEdgeTangentFlowComputer.getUnsupportedReason()
   * for a more thorough (async) check if needed.
   */
  static isWebGPUSupported(): boolean {
    return WebGpuEdgeTangentFlowComputer.isSupported();
  }

  /**
   * Check if WebGL acceleration is available.
   */
  static isWebGLSupported(): boolean {
    return WebGLEdgeTangentFlowComputer.isSupported();
  }

  compute(
    input: ChannelImage,
    config: Partial<ETFConfig> = {},
    sigmaC?: number
  ): Promise<FlowField> {
    return this.run(computer => computer.compute(input, config, sigmaC));
  }

  computeMultiChannel(
    inputs: ChannelImage[],
    config: Partial<ETFConfig> = {},
    sigmaC?: number
  ): Promise<FlowField> {
    return this.run(computer => computer.computeMultiChannel(inputs, config, sigmaC));
  }

  /**
   * Release resources held by whichever backend this instance resolved to.
   * No-op if compute()/computeMultiChannel() was never called, since
   * nothing was ever instantiated.
   */
  dispose(): void {
    this.computer?.dispose();
    this.computer = null;
  }

  /**
   * Run `op` against the resolved backend, resolving (and caching) it on
   * first use. `op` is what actually drives selection in 'auto' mode: a
   * backend only "wins" once it has successfully produced a result, not
   * merely passed isSupported(), since WebGPU/WebGL can pass that cheap
   * check and still fail at adapter/device/shader-compile time.
   */
  private async run<T>(op: (computer: ETFComputer) => Promise<T>): Promise<T> {
    if (this.computer) {
      return op(this.computer);
    }

    if (this.forceImpl === 'webgpu') {
      if (!WebGpuEdgeTangentFlowComputer.isSupported()) {
        throw new Error('WebGPU not supported but webgpu implementation was forced');
      }
      console.log('[ETF] Using WebGPU implementation (forced)');
      const computer = new WebGpuEdgeTangentFlowComputer();
      const result = await op(computer);
      this.computer = computer;
      return result;
    }

    if (this.forceImpl === 'webgl') {
      if (!WebGLEdgeTangentFlowComputer.isSupported()) {
        throw new Error('WebGL not supported but webgl implementation was forced');
      }
      console.log('[ETF] Using WebGL implementation (forced)');
      const computer = new WebGLEdgeTangentFlowComputer();
      const result = await op(computer);
      this.computer = computer;
      return result;
    }

    if (this.forceImpl === 'cpu') {
      console.log('[ETF] Using CPU implementation (forced)');
      const computer = new CpuEdgeTangentFlowComputer();
      const result = await op(computer);
      this.computer = computer;
      return result;
    }

    // 'auto': prefer WebGPU, then WebGL, then CPU. Each tier is disposed
    // immediately if op() throws, so a failed attempt doesn't leak a GPU
    // context while we move on to the next tier.
    if (WebGpuEdgeTangentFlowComputer.isSupported()) {
      const computer = new WebGpuEdgeTangentFlowComputer();
      try {
        console.log('[ETF] Using WebGPU implementation');
        const result = await op(computer);
        this.computer = computer;
        return result;
      } catch (err) {
        console.warn('[ETF] WebGPU implementation failed, falling back:', err);
        computer.dispose();
      }
    }

    if (WebGLEdgeTangentFlowComputer.isSupported()) {
      const computer = new WebGLEdgeTangentFlowComputer();
      try {
        console.log('[ETF] Using WebGL implementation');
        const result = await op(computer);
        this.computer = computer;
        return result;
      } catch (err) {
        console.warn('[ETF] WebGL implementation failed, falling back:', err);
        computer.dispose();
      }
    }

    console.log('[ETF] Using CPU implementation');
    const computer = new CpuEdgeTangentFlowComputer();
    const result = await op(computer);
    this.computer = computer;
    return result;
  }
}

export default EdgeTangentFlowComputer;