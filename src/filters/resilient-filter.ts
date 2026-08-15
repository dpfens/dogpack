/**
 * Shared machinery for "pick the best supported backend, fall back
 * gracefully if it fails later" filters.
 */

import type { ChannelImage, EdgeAwareFilterCore, EdgeAwareFilterCtor } from '../interfaces/base.js';

export abstract class ResilientEdgeAwareFilter<TOptions> implements EdgeAwareFilterCore<TOptions> {
  private readonly failedBackends = new Set<EdgeAwareFilterCtor<TOptions>>();
  private instance: EdgeAwareFilterCore<TOptions>;
  private currentCtor: EdgeAwareFilterCtor<TOptions>;

  /**
   * Subclasses resolve their instance via `resolve()` *before* calling
   * this (in their own async static `create()`), then hand the result in
   * here. The constructor itself stays synchronous, as constructors must.
   */
  protected constructor(
    private readonly candidates: readonly EdgeAwareFilterCtor<TOptions>[],
    resolved: { instance: EdgeAwareFilterCore<TOptions>; ctor: EdgeAwareFilterCtor<TOptions> },
    private readonly config: Partial<TOptions>
  ) {
    this.instance = resolved.instance;
    this.currentCtor = resolved.ctor;
  }

  /**
   * Try each candidate in order, skipping unsupported ones. If a
   * candidate reports supported but throws on construction anyway
   * (isSupported() lied), move on to the next.
   */
  protected static async resolve<TOptions>(
    candidates: readonly EdgeAwareFilterCtor<TOptions>[],
    config: Partial<TOptions>
  ): Promise<{ instance: EdgeAwareFilterCore<TOptions>; ctor: EdgeAwareFilterCtor<TOptions> }> {
    for (const Ctor of candidates) {
      if (await Ctor.isSupported()) {
        try {
          return { instance: new Ctor(config), ctor: Ctor };
        } catch {
          continue;
        }
      }
    }
    throw new Error('No supported filter implementation available');
  }

  get backend() {
    return this.instance.backend;
  }

  dispose(): void {
    this.instance.dispose();
  }

  async apply(input: ChannelImage, options: Partial<TOptions>): Promise<ChannelImage> {
    let current = this.instance;
    while (true) {
      try {
        console.log(`${this.constructor.name}: Running ${current.backend}`);
        return await current.apply(input, options);
      } catch (err) {
        console.warn(`${this.constructor.name}: [${this.currentCtor.name}] process() failed, attempting fallback:`, err);
        const fallback = await this.demoteAndFindNext();
        if (!fallback) throw err;
        current = fallback;
      }
    }
  }

  private async demoteAndFindNext(): Promise<EdgeAwareFilterCore<TOptions> | null> {
    this.failedBackends.add(this.currentCtor);
    this.instance.dispose();
    for (const Ctor of this.candidates) {
      if (this.failedBackends.has(Ctor)) continue;
      if (await Ctor.isSupported()) {
        try {
          this.instance = new Ctor(this.config);
          this.currentCtor = Ctor;
          console.warn(`Falling back to ${Ctor.name}`);
          return this.instance;
        } catch (err) {
          console.warn(`[${Ctor.name}] construction failed despite isSupported():`, err);
          this.failedBackends.add(Ctor);
        }
      }
    }
    return null;
  }
}