import { Component, DestroyRef, effect, inject, input, output, signal } from '@angular/core';

import { PreprocessingService } from '../../../services/preprocessing/preprocessing';
import { ApplicationAnalyticsService } from '../../../services/analytics/application-analytics.service';
import {
  PIPELINE_STEP_LABELS,
  type ChannelMode,
  type PipelineStepConfig,
} from '../../../models/preprocessing';
import { DoGService } from '../../../services/dog/dog-service';
import { ParamSliderComponent } from "../../ui/param-slider-component/param-slider-component";
import { FormsModule } from '@angular/forms';
import { PIPELINE_STEP_HINTS, PREPROCESSING_PRESET_HINTS, PreprocessingPresetName } from '../../content/pipeline-help-content';

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
  templateUrl: './preprocessing-component.html',
  styleUrl: './preprocessing-component.scss',
  imports: [ParamSliderComponent, FormsModule],
})
export class PreprocessingComponent {
  private readonly preprocessing = inject(PreprocessingService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dogService = inject(DoGService);
  private readonly analytics = inject(ApplicationAnalyticsService);

  readonly image = input.required<ImageData>();
  readonly channelImage = output<ImageData>();
  readonly lastOutput = signal<ImageData | null>(null);

  readonly steps = signal<PipelineStepConfig[]>([]);
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

  __on_change__ = effect(async () => {
    const { imageData, channel } = await this.preprocessing.apply(this.steps(), this.image(), this.channelMode());
    this.channelImage.emit(imageData);
    this.lastOutput.set(imageData);
    this.dogService.show({ kind: 'preprocessing' }, imageData);
    this.dogService.setWorkingImage(channel);
  });

  stepSummary(type: PipelineStepConfig['type'] | undefined): string {
    if (!type) return '';
    return PIPELINE_STEP_HINTS[type].summary;
  }

  stepParamHint(type: PipelineStepConfig['type'], param: string): string {
    return PIPELINE_STEP_HINTS[type].params?.[param]?.hint ?? '';
  }

  presetHint(name: PreprocessingPresetName): string {
    return PREPROCESSING_PRESET_HINTS[name] ?? '';
  }

  setChannelMode(mode: ChannelMode): void {
    this.channelMode.set(mode);
    this.analytics.trackPreprocessingChannelModeChanged(mode);
  }

  onAddIndexChange(index: number): void {
    this.selectedAddIndex.set(index);
  }

  addSelectedStep(): void {
    const template = this.addableSteps[this.selectedAddIndex()];
    // Clone so pushing the same template twice doesn't share config objects.
    this.steps.update((current) => [...current, structuredClone(template)]);
    this.analytics.trackPreprocessingStepAdded(template.type);
  }

  removeStep(index: number): void {
    const removed = this.steps()[index];
    this.steps.update((current) => current.filter((_, i) => i !== index));
    if (removed) this.analytics.trackPreprocessingStepRemoved(removed.type);
  }

  moveStepUp(index: number): void {
    if (index === 0) return;
    this.reorderStep(index, index - 1);
    const moved = this.steps()[index - 1];
    if (moved) this.analytics.trackPreprocessingStepReordered(moved.type, 'up');
  }

  moveStepDown(index: number): void {
    const type = this.steps()[index]?.type;
    this.steps.update((current) => {
      if (index >= current.length - 1) return current;
      const next = [...current];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
    if (type) this.analytics.trackPreprocessingStepReordered(type, 'down');
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
    this.analytics.trackPreprocessingPresetSelected(name);
  }
}