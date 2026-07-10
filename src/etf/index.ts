import type { ETFConfig, FlowField, ChannelImage, Vec2 } from '../types.js';
import { EdgeTangentFlowWebGPU } from './webgpu.js';
import { EdgeTangentFlowWebGL } from './webgl.js';
import { EdgeTangentFlow as EdgeTangentFlowCPU } from './cpu.js';

export type ETFImpl = 'cpu' | 'webgl' | 'webgpu' | 'auto';

/**
 * Unified Edge Tangent Flow that automatically selects the best implementation
 *
 * Preference order in 'auto' mode: WebGPU > WebGL > CPU. WebGPU compute is
 * inherently async (device acquisition + buffer readback both require
 * awaiting), so compute() is now async across the board — the WebGL and
 * CPU paths are still synchronous under the hood, but are wrapped so the
 * public API is consistent regardless of which implementation gets picked.
 */
export class EdgeTangentFlow implements FlowField {
  private impl: FlowField;
  readonly width: number;
  readonly height: number;

  private constructor(impl: FlowField) {
    this.impl = impl;
    this.width = impl.width;
    this.height = impl.height;
  }

  getTangent(x: number, y: number): Vec2 {
    return this.impl.getTangent(x, y);
  }

  getTangentArray(): Float32Array {
    return (this.impl as any).getTangentArray();
  }

  visualize(): ChannelImage {
    return (this.impl as any).visualize();
  }

  /**
   * Check if WebGPU acceleration is available
   *
   * Note: this is the same cheap synchronous check EdgeTangentFlowWebGPU
   * itself uses (navigator.gpu presence) — it doesn't guarantee an adapter
   * can actually be obtained. Use EdgeTangentFlowWebGPU.getUnsupportedReason()
   * for a more thorough (async) check if needed.
   */
  static isWebGPUSupported(): boolean {
    return EdgeTangentFlowWebGPU.isSupported();
  }

  /**
   * Check if WebGL acceleration is available
   */
  static isWebGLSupported(): boolean {
    return EdgeTangentFlowWebGL.isSupported();
  }

  /**
   * Compute ETF using the best available implementation
   *
   * @param input Grayscale image
   * @param config ETF configuration
   * @param sigmaC Structure tensor smoothing sigma
   * @param forceImpl Force a specific implementation ('cpu' | 'webgl' | 'webgpu' | 'auto')
   */
  static async compute(
    input: ChannelImage,
    config: Partial<ETFConfig> = {},
    sigmaC?: number,
    forceImpl: ETFImpl = 'auto'
  ): Promise<EdgeTangentFlow> {
    if (forceImpl === 'webgpu') {
      if (!EdgeTangentFlowWebGPU.isSupported()) {
        throw new Error('WebGPU not supported but webgpu implementation was forced');
      }
      console.log('[ETF] Using WebGPU implementation (forced)');
      const impl = await EdgeTangentFlowWebGPU.compute(input, config, sigmaC);
      return new EdgeTangentFlow(impl);
    }

    if (forceImpl === 'webgl') {
      if (!EdgeTangentFlowWebGL.isSupported()) {
        throw new Error('WebGL not supported but webgl implementation was forced');
      }
      console.log('[ETF] Using WebGL implementation (forced)');
      const impl = EdgeTangentFlowWebGL.compute(input, config, sigmaC);
      return new EdgeTangentFlow(impl);
    }

    if (forceImpl === 'cpu') {
      console.log('[ETF] Using CPU implementation (forced)');
      const impl = EdgeTangentFlowCPU.compute(input, config, sigmaC);
      return new EdgeTangentFlow(impl);
    }

    // 'auto': prefer WebGPU, then WebGL, then CPU. Each tier falls through
    // to the next on failure — WebGPU in particular can pass the cheap
    // isSupported() check but still fail at adapter/device acquisition
    // time, so that's guarded with a try/catch rather than trusted blindly.
    if (EdgeTangentFlowWebGPU.isSupported()) {
      try {
        console.log('[ETF] Using WebGPU implementation');
        const impl = await EdgeTangentFlowWebGPU.compute(input, config, sigmaC);
        return new EdgeTangentFlow(impl);
      } catch (err) {
        console.warn('[ETF] WebGPU implementation failed, falling back:', err);
      }
    }

    if (EdgeTangentFlowWebGL.isSupported()) {
      try {
        console.log('[ETF] Using WebGL implementation');
        const impl = EdgeTangentFlowWebGL.compute(input, config, sigmaC);
        return new EdgeTangentFlow(impl);
      } catch (err) {
        console.warn('[ETF] WebGL implementation failed, falling back:', err);
      }
    }

    console.log('[ETF] Using CPU implementation');
    const impl = EdgeTangentFlowCPU.compute(input, config, sigmaC);
    return new EdgeTangentFlow(impl);
  }

  /**
   * Cleanup WebGPU and WebGL resources
   */
  static dispose(): void {
    EdgeTangentFlowWebGPU.dispose();
    EdgeTangentFlowWebGL.dispose();
  }
}

export default EdgeTangentFlow;