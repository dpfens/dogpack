import type {
  BlurStrategy,
  BlurStrategyCtor,
  ChannelImage,
  FlowField,
  GradientAlignedBlurConfig,
} from '../../interfaces/base.js';
import { CPUGradientAlignedBlur } from './cpu.js';
import { WebGLGradientAlignedBlur } from './webgl.js';
import { WebGPUGradientAlignedBlur } from './webgpu.js';

// Backends expose `setFlowField` beyond the base `BlurStrategy` shape;
// `BlurStrategyCtor.new()` is typed to return plain `BlurStrategy`, so we
// widen locally rather than adding setFlowField to the shared interface
// (Preprocessor/ETFComputer backends have no equivalent concept).
type BackendInstance = BlurStrategy & {
  setFlowField?(flowField: FlowField): void;
};

export class GradientAlignedBlur implements BlurStrategy {
  private failedBackends = new Set<BlurStrategyCtor>();

  private constructor(
    private instance: BackendInstance,
    private currentCtor: BlurStrategyCtor,
    private flowField: FlowField,
    private config: Partial<GradientAlignedBlurConfig>,
  ) {}

  // Ordered best-to-worst. `satisfies` (not `implements`) catches a
  // backend missing isSupported() or the instance shape at this line.
  private static readonly candidates = [
    WebGPUGradientAlignedBlur,
    WebGLGradientAlignedBlur,
    CPUGradientAlignedBlur,
  ] satisfies BlurStrategyCtor[];

  static async create(
    flowField: FlowField,
    config: Partial<GradientAlignedBlurConfig> = {},
  ): Promise<GradientAlignedBlur> {
    for (const Ctor of GradientAlignedBlur.candidates) {
      if (await Ctor.isSupported()) {
        try {
          const instance = new Ctor({ ...config, flowField }) as BackendInstance;
          return new GradientAlignedBlur(instance, Ctor, flowField, config);
        } catch {
          continue; // isSupported() lied — try next
        }
      }
    }
    throw new Error('No supported gradient-aligned blur implementation available');
  }

  get backend() {
    return this.instance.backend;
  }

  dispose(): void {
    this.instance.dispose();
  }

  async blur(input: ChannelImage, sigma: number): Promise<ChannelImage> {
    let current = this.instance;
    while (true) {
      try {
        console.log(`${this.constructor.name}: Running ${current.backend}`);
        return await current.blur(input, sigma);
      } catch (err) {
        console.warn(`${this.constructor.name}: [${this.currentCtor.name}] process() failed, attempting fallback:`, err);
        const fallback = await this.demoteAndFindNext();
        if (!fallback) throw err;
        current = fallback;
      }
    }
  }

  /**
   * Propagates to whatever backend is currently running, and is also
   * remembered for any future backend constructed by demoteAndFindNext()
   * (fallback instances are built fresh via `new Ctor(config)`, so the
   * current flow field has to be threaded through `config` each time
   * rather than mutated on an existing instance).
   */
  setFlowField(flowField: FlowField): void {
    this.flowField = flowField;
    this.instance.setFlowField?.(flowField);
  }

  private async demoteAndFindNext(): Promise<BlurStrategy | null> {
    this.failedBackends.add(this.currentCtor);
    this.instance.dispose();
    for (const Ctor of GradientAlignedBlur.candidates) {
      if (this.failedBackends.has(Ctor)) continue;
      if (await Ctor.isSupported()) {
        try {
          console.warn(`Falling back to ${Ctor.name}`);
          this.instance = new Ctor({ ...this.config, flowField: this.flowField }) as BackendInstance;
          this.currentCtor = Ctor;
          return this.instance;
        } catch(err) {
          console.warn(`[${Ctor.name}] construction failed despite isSupported():`, err);
          this.failedBackends.add(Ctor);
        }
      }
    }
    return null;
  }
}