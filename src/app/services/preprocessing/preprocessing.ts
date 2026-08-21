import { Injectable, signal } from '@angular/core';

import {
  PreprocessingPipeline,
  PreprocessingPresets,
} from 'dogpack/preprocess';
import type { ChannelImage, Preprocessor } from 'dogpack';
import type { ChannelMode, PipelineStepConfig } from '../../models/preprocessing';
import { imageDataToLuminance, luminanceToImageData } from 'dogpack/utils';

export interface PreprocessingResult {
  imageData: ImageData;
  channel: ChannelImage;
}

@Injectable({ providedIn: 'root' })
export class PreprocessingService {
  /** Exposed for templates/debug UI that want to show "GPU" vs "CPU". */

  /** Force CPU regardless of WebGL availability (e.g. a debug toggle). */
  readonly forceCPU = signal(false);

  private refCount = 0;

  /**
   * Turn a declarative list of steps into a real, ready-to-run pipeline.
   * Backend selection happens per-step at the moment each is added,
   * matching PreprocessingPipeline's own semantics.
   */
  async buildPipeline(steps: PipelineStepConfig[]): Promise<PreprocessingPipeline> {
    const pipeline = new PreprocessingPipeline();

    for (const step of steps) {
      switch (step.type) {
        case 'bilateral':
          await pipeline.bilateral(step.config);
          break;
        case 'median':
          await pipeline.median(step.config);
          break;
        case 'kuwahara':
          await pipeline.kuwahara(step.config);
          break;
        case 'gaussian':
          await pipeline.gaussian(step.sigma);
          break;
        case 'contrast':
          await pipeline.contrast(step.blackPoint, step.whitePoint);
          break;
        case 'quantize':
          await pipeline.quantize(step.levels);
          break;
        case 'preset':
          // Presets are plain functions (ChannelImage) => ChannelImage,
          // so wrap one as a single custom pipeline stage via `.use()`.
          await pipeline.use(await this.presetAsPreprocessor(step.name));
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

  async apply(steps: PipelineStepConfig[], input: ImageData, mode: ChannelMode): Promise<PreprocessingResult> {
    const pipeline = await this.buildPipeline(steps);

    const { luminance, alpha } = this.imageDataToLuminanceChannel(input);
    const channel = await pipeline.apply(luminance);
    return { imageData: luminanceToImageData(channel, alpha), channel };
  }

  /** Lower-level escape hatch for callers that already have a ChannelImage. */
  async applyToChannel(steps: PipelineStepConfig[], input: ChannelImage): Promise<ChannelImage> {
    const pipeline = await this.buildPipeline(steps)
    return await pipeline.apply(input);
  }

  private presetAsPreprocessor(name: keyof typeof PreprocessingPresets): Preprocessor {
    return {
      process: (input: ChannelImage) => PreprocessingPresets[name](input),
      backend: 'cpu',
      dispose: () => {},
    };
  }

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
}
