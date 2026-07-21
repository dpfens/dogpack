import type { ETFComputer, ETFComputerCtor, ETFConfig, FlowField, ChannelImage, ETFDetailedResult } from '../interfaces/base.js';
import { WebGpuEdgeTangentFlowComputer } from './webgpu.js';
import { WebGLEdgeTangentFlowComputer } from './webgl.js';
import { CpuEdgeTangentFlowComputer } from './cpu.js';

/**
 * Edge Tangent Flow computer that automatically resolves to the best
 * supported backend, with graceful single-retry fallback if that backend
 * fails after selection (driver crash, lost context, etc).
 *
 */
export class EdgeTangentFlowComputer implements ETFComputer {
  private failedBackends = new Set<ETFComputerCtor>();

  private constructor(
    private instance: ETFComputer,
    private currentCtor: ETFComputerCtor
  ) {}

  private static readonly candidates = [
    WebGpuEdgeTangentFlowComputer,
    WebGLEdgeTangentFlowComputer,
    CpuEdgeTangentFlowComputer,
  ] satisfies ETFComputerCtor[];

  static async create(): Promise<EdgeTangentFlowComputer> {
    for (const Ctor of EdgeTangentFlowComputer.candidates) {
      if (await Ctor.isSupported()) {
        try {
          return new EdgeTangentFlowComputer(new Ctor(), Ctor);
        } catch {
          continue; // isSupported() lied — try next
        }
      }
    }
    throw new Error('No supported ETF computer implementation available');
  }

  /**
   * Which backend is actually running right now. Can change over the
   * life of this instance if a fallback occurs mid-session.
   */
  get backend() {
    return this.instance.backend;
  }

  dispose() {
    this.instance.dispose();
  }

  async compute(
    input: ChannelImage,
    config: Partial<ETFConfig> = {},
    sigmaC?: number
  ): Promise<FlowField> {
    return this.callWithFallback(computer => computer.compute(input, config, sigmaC));
  }

  async computeDetailed(
    input: ChannelImage,
    config: Partial<ETFConfig> = {},
    sigmaC?: number
  ): Promise<ETFDetailedResult> {
    return this.callWithFallback(computer => computer.computeDetailed(input, config, sigmaC));
  }

  async computeMultiChannel(
    inputs: ChannelImage[],
    config: Partial<ETFConfig> = {},
    sigmaC?: number
  ): Promise<FlowField> {
    return this.callWithFallback(computer => computer.computeMultiChannel(inputs, config, sigmaC));
  }

  async computeMultiChannelDetailed(
    inputs: ChannelImage[],
    config: Partial<ETFConfig> = {},
    sigmaC?: number
  ): Promise<ETFDetailedResult> {
    return this.callWithFallback(computer => computer.computeMultiChannelDetailed(inputs, config, sigmaC));
  }

  async callWithFallback<T>(op: (computer: ETFComputer) => Promise<T>): Promise<T> {
    let current = this.instance;
    while (true) {
      try {
        console.log(`${this.constructor.name}: Running ${current.backend}`);
        return await op(this.instance);
      } catch (err) {
        console.warn(`${this.constructor.name}: [${this.currentCtor.name}] process() failed, attempting fallback:`, err);
        const fallback = await this.demoteAndFindNext();
        if (!fallback) throw err;
        current = fallback;
      }
    }
  }

  private async demoteAndFindNext(): Promise<ETFComputer | null> {
    this.failedBackends.add(this.currentCtor);
    this.instance.dispose();
    for (const Ctor of EdgeTangentFlowComputer.candidates) {
      if (this.failedBackends.has(Ctor)) continue;
      if (await Ctor.isSupported()) {
        try {
          this.instance = new Ctor();
          this.currentCtor = Ctor;
          console.warn(`Falling back to ${Ctor.name}`);
          return this.instance;
        } catch (err) {
          console.warn(`[${Ctor.name}] construction failed despite isSupported():`, err);
          this.failedBackends.add(Ctor); // isSupported() lied — try next
        }
      }
    }
    return null;
  }
}

export default EdgeTangentFlowComputer;