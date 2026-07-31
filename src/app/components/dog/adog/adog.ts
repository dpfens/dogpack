import { Component, computed, effect, input, model, signal, untracked } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  DoGConfig,
  DogConfigParamType,
  ADOG_PARAM_RANGES,
  ADogConfigParamType,
  ParamRange,
  ADOG_STYLE_PRESETS,
} from 'dogpack/dog';
import { DogComponent } from '../dog/dog';
import { ParamSliderComponent } from '../../ui/param-slider-component/param-slider-component';
import { WireDoGConfig, ADogConfig, ADogPreset, WireADoGConfig, ThresholdStrategyDescriptor } from '../../../models/dog';
import { DogPreviewableComponent } from '../base';
import { DogFocusLabel } from '../../../services/dog/dog-service';
import { ADOG_EXTRA_PARAM_HINTS, withRange } from '../../content/pipeline-help-content';
import { presetFromLibrary } from '../../../utilities/dog';

type ThresholdType = 'Soft' | 'Hard';

const THRESHOLD_TYPE_TO_DESCRIPTOR_KIND: Record<ThresholdType, ThresholdStrategyDescriptor['kind']> = {
  Soft: 'soft',
  Hard: 'hard',
};

@Component({
  selector: 'adog',
  imports: [DogComponent, ReactiveFormsModule, ParamSliderComponent],
  templateUrl: './adog.html',
  styleUrl: './adog.scss',
  providers: [],
})
export class ADogComponent extends DogPreviewableComponent<ADogConfig> {
  readonly paramRanges: Record<DogConfigParamType | ADogConfigParamType, ParamRange> =
    ADOG_PARAM_RANGES;

  readonly config = model<WireADoGConfig>({} as WireADoGConfig);

  private adogKeys: ADogConfigParamType[] = ['tau', 's', 'noiseScaleC', 'kernelSizeMultiplier'];

  readonly tau = this.rangeControl('tau');
  readonly s = this.rangeControl('s');
  readonly noiseScaleC = this.rangeControl('noiseScaleC');
  readonly kernelSizeMultiplier = this.rangeControl('kernelSizeMultiplier');

  private controlFor: Record<ADogConfigParamType, FormControl<number>> = {
    tau: this.tau,
    s: this.s,
    noiseScaleC: this.noiseScaleC,
    kernelSizeMultiplier: this.kernelSizeMultiplier,
  };

  readonly thresholdStrategyKey = signal<ThresholdType>('Soft');

  readonly thresholdOptions: { key: ThresholdType; label: string }[] = [
    { key: 'Soft', label: 'Soft' },
    { key: 'Hard', label: 'Hard' },
  ];

  // Presets are plain numeric param bags -- see ADogPreset in models/dog.ts.
  readonly presetNames = Object.keys(ADOG_STYLE_PRESETS);
  readonly selectedPreset = signal<ADogPreset | null>(null);
  preset = input<ADogPreset | null>(null);
  private effectivePreset = computed(() => this.preset() ?? this.selectedPreset());

  __on_preset__ = effect(() => {
    const p = this.selectedPreset();
    if (!p) return;
    untracked(() => {
      for (const key of this.adogKeys) {
        const val = p[key];
        if (typeof val === 'number') {
          this.controlFor[key].setValue(val);
        }
      }
    });
  });

  protected focusLabel(): DogFocusLabel {
    return { kind: 'adog' };
  }

  private rangeControl(key: ADogConfigParamType): FormControl<number> {
    const r = this.paramRanges[key];
    return new FormControl<number>(r.default, {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.min(r.hardMin),
        Validators.max(r.hardMax),
      ],
    });
  }

  private buildThresholdStrategyDescriptor(): ThresholdStrategyDescriptor {
    return { kind: THRESHOLD_TYPE_TO_DESCRIPTOR_KIND[this.thresholdStrategyKey()] };
  }

  hint(key: ADogConfigParamType): string {
    return withRange(ADOG_EXTRA_PARAM_HINTS[key].hint, this.paramRanges[key]);
  }

  selectPreset(name: string): void {
    const preset = ADOG_STYLE_PRESETS[name];
    this.selectedPreset.set(preset ? presetFromLibrary<ADogPreset>(preset) : null);
    if (name) this.analytics.trackDogPresetSelected('adog', name);
  }

  onConfig(config: WireDoGConfig) {
    // Merge the base DoG params + thresholdStrategy descriptor (from the
    // nested <dog> component) with the ADoG extras.
    const adogConfig: WireADoGConfig = {
      ...config,
      tau: this.tau.value,
      s: this.s.value,
      noiseScaleC: this.noiseScaleC.value,
      kernelSizeMultiplier: this.kernelSizeMultiplier.value,
    };
    this.config.set(adogConfig);
  }

  toModel(): ADogConfig {
    return { kind: 'config', type: 'adog', config: this.config() };
  }
}