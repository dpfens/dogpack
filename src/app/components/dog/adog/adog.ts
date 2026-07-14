import { Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  DoGConfig,
  DogConfigParamType,
  ADOG_PARAM_RANGES,
  ADogConfigParamType,
  ParamRange,
  ADOG_STYLE_PRESETS,
} from 'dogpack/dog';
import { ChannelImage } from 'dogpack';
import { DogComponent } from '../dog/dog';
import { ParamSliderComponent } from '../../ui/param-slider-component/param-slider-component';
import { WireDoGConfig, ADogConfig, ADogPreset, DogModelProvider, WireADoGConfig, ThresholdStrategyDescriptor } from '../../../models/dog';
import { DoGService } from '../../../services/dog/dog-service';
import { luminanceToImageData } from 'dogpack/utils';

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
export class ADogComponent implements DogModelProvider<ADogConfig> {
  readonly paramRanges: Record<DogConfigParamType | ADogConfigParamType, ParamRange> =
    ADOG_PARAM_RANGES;

  readonly config = model<WireADoGConfig>({} as WireADoGConfig);

  readonly channelImage = output<ChannelImage>();
  readonly previewPending = signal(false);
  private readonly dogService = inject(DoGService);

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

  async runPreview(): Promise<void> {
    this.previewPending.set(true);
    this.dogService.setPending({ kind: 'adog' });
    try {
      const image = await this.dogService.run(this.toModel());
      if (image) {
        this.channelImage.emit(image);
        this.dogService.show({ kind: 'adog' }, luminanceToImageData(image));
      }
    } finally {
      this.previewPending.set(false);
    }
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

  selectPreset(name: string): void {
    this.selectedPreset.set(ADOG_STYLE_PRESETS[name] ?? null);
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