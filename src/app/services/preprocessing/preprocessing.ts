import { Injectable, signal } from '@angular/core';

import {
  PreprocessingPipeline,
  PreprocessingPresets,
} from 'dogpack/preprocess';
import {
  webgl,
} from 'dogpack/preprocess';
import type { ChannelImage, Preprocessor } from 'dogpack';
import type { ChannelMode, PipelineStepConfig } from '../../models/preprocessing';
import { imageDataToLuminance, luminanceToImageData } from 'dogpack/utils';

interface RGBChannels {
  r: ChannelImage;
  g: ChannelImage;
  b: ChannelImage;
}

/** Result of running a pipeline: the display-ready image, plus a single
 *  ChannelImage suitable for feeding the DoG worker (see apply() below for
 *  how that's derived in each mode). */
export interface PreprocessingResult {
  imageData: ImageData;
  channel: ChannelImage;
}

/**
 * Owns everything dogpack-related that shouldn't live on a component:
 *
 *  - Backend selection (GPU vs CPU), including an app-wide override the
 *    user can flip (e.g. a debug toggle to force CPU).
 *  - Turning a declarative PipelineStepConfig[] into a real
 *    PreprocessingPipeline.
 *  - Ref-counted lifecycle for the shared WebGL context. Components
 *    "check out" the service in ngOnInit/constructor via acquire(), and
 *    "check in" via release() in ngOnDestroy. disposeWebGL() only runs
 *    once nobody is using it, so one component's teardown never yanks
 *    the GL context out from under a sibling that's still rendering.
 */
@Injectable({ providedIn: 'root' })
export class PreprocessingService {
  /** Exposed for templates/debug UI that want to show "GPU" vs "CPU". */
  readonly usingWebGL = signal(webgl.isWebGLAvailable());

  /** Force CPU regardless of WebGL availability (e.g. a debug toggle). */
  readonly forceCPU = signal(false);

  private refCount = 0;

  /** Call once per consumer (component/feature) that will build pipelines. */
  acquire(): void {
    this.refCount++;
  }

  /**
   * Call once per matching acquire(), typically in ngOnDestroy. Only
   * actually tears down the shared GL context when the last consumer
   * releases it.
   */
  release(): void {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount === 0) {
      webgl.disposeWebGL();
    }
  }

  /**
   * Turn a declarative list of steps into a real, ready-to-run pipeline.
   * Backend selection happens per-step at the moment each is added,
   * matching PreprocessingPipeline's own semantics.
   */
  buildPipeline(steps: PipelineStepConfig[]): PreprocessingPipeline {
    const pipeline = new PreprocessingPipeline();

    for (const step of steps) {
      switch (step.type) {
        case 'bilateral':
          pipeline.bilateral(step.config);
          break;
        case 'median':
          pipeline.median(step.config);
          break;
        case 'kuwahara':
          pipeline.kuwahara(step.config);
          break;
        case 'gaussian':
          pipeline.gaussian(step.sigma);
          break;
        case 'contrast':
          pipeline.contrast(step.blackPoint, step.whitePoint);
          break;
        case 'quantize':
          pipeline.quantize(step.levels);
          break;
        case 'preset':
          // Presets are plain functions (ChannelImage) => ChannelImage,
          // so wrap one as a single custom pipeline stage via `.use()`.
          pipeline.use(this.presetAsPreprocessor(step.name));
          break;
        default: {
          // Exhaustiveness check: if this errors, a PipelineStepConfig
          // variant was added without a case here.
          const _exhaustive: never = step;
          throw new Error(`Unhandled step type: ${JSON.stringify(_exhaustive)}`);
        }
      }
    }

    return pipeline;
  }

  /**
   * Build and immediately run a pipeline against a native ImageData.
   * Returns both the display-ready ImageData and a ChannelImage suitable
   * for handing to DoGService.setWorkingImage() (see PreprocessingComponent).
   *
   * - mode 'luminance': converts to a single derived luminance channel,
   *   runs the pipeline once, and expands the result back to grayscale.
   *   The pipeline's own output channel is exactly what's returned as
   *   `channel` - no extra derivation needed.
   * - mode 'rgb': runs the (same, single-built) pipeline independently
   *   over each of R/G/B, then recombines for display. There's no single
   *   canonical channel once each has been processed independently, so
   *   `channel` here is an interim bridge: it's re-derived via
   *   imageDataToLuminance() from the recombined RGB result, using the
   *   same luminance weights the 'luminance' path trusts elsewhere. This
   *   is NOT the same as running the pipeline once on a luminance channel
   *   - it's luminance-of-the-independently-processed-RGB-result. Real
   *   multi-channel DoG (see ETFComputer.computeMultiChannel) would need
   *   DogRunRequest to carry more than one ChannelImage; this is a
   *   placeholder until that's built.
   */
  async apply(steps: PipelineStepConfig[], input: ImageData, mode: ChannelMode): Promise<PreprocessingResult> {
    const pipeline = this.buildPipeline(steps);

    if (mode === 'luminance') {
      const { luminance, alpha } = this.imageDataToLuminanceChannel(input);
      const channel = await pipeline.apply(luminance);
      return { imageData: luminanceToImageData(channel, alpha), channel };
    }

    const { channels, alpha } = this.imageDataToRGBChannels(input);
    const [r, g, b] = await Promise.all([
      pipeline.apply(channels.r),
      pipeline.apply(channels.g),
      pipeline.apply(channels.b)
    ]);
    const processed: RGBChannels = {r, g, b};
    const imageData = this.rgbChannelsToImageData(processed, alpha);
    const channel = imageDataToLuminance(imageData);
    return { imageData, channel };
  }

  /** Lower-level escape hatch for callers that already have a ChannelImage. */
  async applyToChannel(steps: PipelineStepConfig[], input: ChannelImage): Promise<ChannelImage> {
    return this.buildPipeline(steps).apply(input);
  }

  private presetAsPreprocessor(name: keyof typeof PreprocessingPresets): Preprocessor {
    return {
      process: (input: ChannelImage) => PreprocessingPresets[name](input),
      backend: 'cpu',
      dispose: () => {},
    };
  }

  // --------------------------------------------------------------------
  // ImageData <-> ChannelImage conversion
  //
  // Only used by apply() above. Luminance conversion delegates to
  // dogpack's own imageDataToLuminance/luminanceToImageData so the luma
  // weights can't drift from what the rest of the library assumes; alpha
  // is handled here since dogpack's filters have no concept of it and
  // (for the forward direction) imageDataToLuminance doesn't carry it.
  // RGB split/recombine has no dogpack equivalent, so it's fully local.
  // --------------------------------------------------------------------

  private imageDataToLuminanceChannel(
    imageData: ImageData
  ): { luminance: ChannelImage; alpha: Uint8ClampedArray } {
    const luminance = imageDataToLuminance(imageData);
    const pixelCount = imageData.width * imageData.height;
    const alpha = new Uint8ClampedArray(pixelCount);

    for (let i = 0; i < pixelCount; i++) {
      alpha[i] = imageData.data[i * 4 + 3];
    }

    return { luminance, alpha };
  }

  private imageDataToRGBChannels(
    imageData: ImageData
  ): { channels: RGBChannels; alpha: Uint8ClampedArray } {
    const { width, height, data } = imageData;
    const pixelCount = width * height;
    const r = new Float32Array(pixelCount);
    const g = new Float32Array(pixelCount);
    const b = new Float32Array(pixelCount);
    const alpha = new Uint8ClampedArray(pixelCount);

    for (let i = 0; i < pixelCount; i++) {
      const o = i * 4;
      r[i] = data[o] / 255;
      g[i] = data[o + 1] / 255;
      b[i] = data[o + 2] / 255;
      alpha[i] = data[o + 3];
    }

    return {
      channels: {
        r: { data: r, width, height },
        g: { data: g, width, height },
        b: { data: b, width, height },
      },
      alpha,
    };
  }

  private rgbChannelsToImageData(channels: RGBChannels, alpha: Uint8ClampedArray): ImageData {
    const { width, height } = channels.r;
    const out = new Uint8ClampedArray(width * height * 4);

    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      out[o] = clamp255(channels.r.data[i] * 255);
      out[o + 1] = clamp255(channels.g.data[i] * 255);
      out[o + 2] = clamp255(channels.b.data[i] * 255);
      out[o + 3] = alpha[i];
    }

    return new ImageData(out, width, height);
  }
}

function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}