import { Component, DestroyRef, effect, inject, input, output, signal } from '@angular/core';

import { PreprocessingService } from '../../../services/preprocessing/preprocessing';
import {
  PIPELINE_STEP_LABELS,
  type ChannelMode,
  type PipelineStepConfig,
} from '../../../models/preprocessing';
import { DoGService } from '../../../services/dog/dog-service';
import { ImageCanvasComponent } from "../../ui/image-canvas/image-canvas";

type PresetName = 'light' | 'standard' | 'heavy' | 'artistic' | 'nature';

const PRESET_NAMES: PresetName[] = ['light', 'standard', 'heavy', 'artistic', 'nature'];

/** Step types a user can add from the "Add step" dropdown, with sane defaults. */
const ADDABLE_STEPS: PipelineStepConfig[] = [
  { type: 'preset', name: 'standard' },
  { type: 'bilateral', config: { sigmaSpatial: 4, sigmaRange: 0.1 } },
  { type: 'median', config: { radius: 2 } },
  { type: 'kuwahara', config: { radius: 3 } },
  { type: 'gaussian', sigma: 1.0 },
  { type: 'contrast', blackPoint: 0.01, whitePoint: 0.99 },
  { type: 'quantize', levels: 8 },
];

@Component({
  selector: 'app-preprocessing-component',
  imports: [ImageCanvasComponent],
  templateUrl: './preprocessing-component.html',
  styleUrl: './preprocessing-component.scss',
})
export class PreprocessingComponent {
  private readonly preprocessing = inject(PreprocessingService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dogService = inject(DoGService);

  /** Source image supplied by the parent, as a native ImageData. */
  readonly image = input.required<ImageData>();

  /**
   * The pipeline result. This is the *only* way the outside world sees the
   * output of this component - it no longer draws anything itself. A parent
   * "workbench" is expected to feed this (and `image`, for before/after) into
   * a single shared <app-image-canvas> along with whatever else is being
   * examined (xdog/fdog/adog/hdog).
   */
  readonly channelImage = output<ImageData>();
  readonly lastOutput = signal<ImageData | null>(null);

  readonly steps = signal<PipelineStepConfig[]>([{ type: 'preset', name: 'standard' }]);
  readonly channelMode = signal<ChannelMode>('rgb');
  readonly selectedAddIndex = signal(0);

  readonly stepLabels = PIPELINE_STEP_LABELS;
  readonly addableSteps = ADDABLE_STEPS;
  readonly presetNames = PRESET_NAMES;
  readonly usingWebGL = this.preprocessing.usingWebGL;

  constructor() {
    this.preprocessing.acquire();
    this.destroyRef.onDestroy(() => this.preprocessing.release());
  }

  // Re-run the pipeline whenever the source image, mode, or steps change,
  // and hand the result off. No canvas work happens here anymore.
  // Unlike the DoG components, this still recomputes eagerly (synchronously,
  // on the main thread) rather than behind a manual "preview" button, since
  // PreprocessingService.apply() is currently cheap enough for that. It
  // still claims DoGService focus on every recompute, same as the DoG
  // components do on their own explicit runPreview() - i.e. touching a
  // preprocessing control while looking at an xdog/etc. preview will pull
  // focus back to preprocessing. Flag if that's not the desired feel.
  __on_change__ = effect(async () => {
      console.log(this.steps());
      const { imageData, channel } = await this.preprocessing.apply(this.steps(), this.image(), this.channelMode());
      this.channelImage.emit(imageData);
      this.lastOutput.set(imageData);
      this.dogService.show({ kind: 'preprocessing' }, imageData);
      // Feeds DoGService.run() - every xdog/fdog/adog/hdog/layer Preview
      // reads whatever's here at call time. See PreprocessingService.apply()
      // for how `channel` is derived in 'rgb' vs 'luminance' mode.
      this.dogService.setWorkingImage(channel);
    });

  setChannelMode(mode: ChannelMode): void {
    this.channelMode.set(mode);
  }

  onAddIndexChange(index: number): void {
    this.selectedAddIndex.set(index);
  }

  addSelectedStep(): void {
    console.log(this.addableSteps, this.selectedAddIndex());
    const template = this.addableSteps[this.selectedAddIndex()];
    // Clone so pushing the same template twice doesn't share config objects.
    this.steps.update((current) => [...current, structuredClone(template)]);
  }

  removeStep(index: number): void {
    this.steps.update((current) => current.filter((_, i) => i !== index));
  }

  moveStepUp(index: number): void {
    if (index === 0) return;
    this.reorderStep(index, index - 1);
  }

  moveStepDown(index: number): void {
    this.steps.update((current) => {
      if (index >= current.length - 1) return current;
      const next = [...current];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  private reorderStep(from: number, to: number): void {
    this.steps.update((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  updateBilateral(index: number, key: 'sigmaSpatial' | 'sigmaRange', value: number): void {
    this.steps.update((current) =>
      current.map((step, i) =>
        i === index && step.type === 'bilateral'
          ? { ...step, config: { ...step.config, [key]: value } }
          : step
      )
    );
  }

  updateRadius(index: number, value: number): void {
    this.steps.update((current) =>
      current.map((step, i) =>
        i === index && (step.type === 'median' || step.type === 'kuwahara')
          ? { ...step, config: { ...step.config, radius: value } }
          : step
      )
    );
  }

  updateGaussianSigma(index: number, value: number): void {
    this.steps.update((current) =>
      current.map((step, i) => (i === index && step.type === 'gaussian' ? { ...step, sigma: value } : step))
    );
  }

  updateContrast(index: number, key: 'blackPoint' | 'whitePoint', value: number): void {
    this.steps.update((current) =>
      current.map((step, i) => (i === index && step.type === 'contrast' ? { ...step, [key]: value } : step))
    );
  }

  updateQuantizeLevels(index: number, value: number): void {
    this.steps.update((current) =>
      current.map((step, i) => (i === index && step.type === 'quantize' ? { ...step, levels: value } : step))
    );
  }

  updatePresetName(index: number, name: PresetName): void {
    this.steps.update((current) =>
      current.map((step, i) => (i === index && step.type === 'preset' ? { ...step, name } : step))
    );
  }
}