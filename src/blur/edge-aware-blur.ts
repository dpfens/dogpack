import type { BlurStrategy, ChannelImage, EdgeAwareFilterCore } from "../interfaces/base.js";

export class EdgeAwareBlur<TConfig> implements BlurStrategy {
  constructor(
    private filter: EdgeAwareFilterCore<TConfig>,
    private toConfig: (sigma: number) => TConfig,
  ) {}

  blur(input: ChannelImage, sigma: number): Promise<ChannelImage> {
    return this.filter.apply(input, this.toConfig(sigma));
  }

  get backend() { return this.filter.backend; }
  dispose() { this.filter.dispose(); }
}