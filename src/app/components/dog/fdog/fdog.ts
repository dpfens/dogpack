import { Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  DoGConfig,
  DogConfigParamType,
  FDOG_PARAM_RANGES,
  FDOG_STYLE_PRESETS,
  FDogConfigParamType,
  ParamRange,
} from 'dogpack/dog';
import { ChannelImage, FDoGConfig } from 'dogpack';
import { DogComponent } from '../dog/dog';
import { ParamSliderComponent } from '../../ui/param-slider-component/param-slider-component';
import { DogModelProvider, FDogConfig, FDogPreset, WireDoGConfig, WireFDoGConfig } from '../../../models/dog';
import { DoGService } from '../../../services/dog/dog-service';

@Component({
  selector: 'fdog',
  imports: [DogComponent, ReactiveFormsModule, ParamSliderComponent],
  templateUrl: './fdog.html',
  styleUrl: './fdog.scss',
  providers: [],
})
export class FDogComponent implements DogModelProvider<FDogConfig> {
  readonly paramRanges: Record<DogConfigParamType | FDogConfigParamType, ParamRange> =
    FDOG_PARAM_RANGES;

  readonly config = model<WireFDoGConfig>({} as WireFDoGConfig);

  /** Same contract as xdog/adog/hdog - see xdog.ts for the full rationale. */
  readonly channelImage = output<ChannelImage>();

  /** True while a preview run is in flight - bind a spinner/disabled state to this. */
  readonly previewPending = signal(false);
  dogService = inject(DoGService);

  // FDoG-specific keys that DogComponent doesn't manage. Kept as a list so the
  // preset effect and any future validation can iterate them.
  private fdogKeys: FDogConfigParamType[] = ['sigmaC', 'sigmaM', 'sigmaA'];

  // Extra controls, one per FDoG-specific param.
  readonly sigmaC = this.rangeControl('sigmaC');
  readonly sigmaM = this.rangeControl('sigmaM');
  readonly sigmaA = this.rangeControl('sigmaA');

  private controlFor: Record<FDogConfigParamType, FormControl<number>> = {
    sigmaC: this.sigmaC,
    sigmaM: this.sigmaM,
    sigmaA: this.sigmaA,
  };

  // Selected preset drives both the DoG params (via <dog [preset]>) and the
  // FDoG extras (via the effect below). null = "Custom".
  readonly presetNames = Object.keys(FDOG_STYLE_PRESETS);
  readonly selectedPreset = signal<FDogPreset | null>(null);
  preset = input<FDogPreset | null>(null);
  private effectivePreset = computed(() => this.preset() ?? this.selectedPreset());;

  // When a preset is chosen, patch the FDoG extras. The base DoG params are
  // handled by DogComponent, which receives the same preset as an input.
  __on_preset__ = effect(() => {
    const p = this.selectedPreset();
    if (!p) return;
    untracked(() => {
      for (const key of this.fdogKeys) {
        const val = p[key];
        if (typeof val === 'number') {
          this.controlFor[key].setValue(val);
        }
      }
    });
  });

  /** Wire this to a "Preview" button in fdog.html - config changes no longer preview automatically. */
  async runPreview(): Promise<void> {
    this.previewPending.set(true);
    try {
      const image = await this.dogService.run(this.toModel());
      if (image) this.channelImage.emit(image);
    } finally {
      this.previewPending.set(false);
    }
  }

  private rangeControl(key: FDogConfigParamType): FormControl<number> {
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

  selectPreset(name: string): void {
    this.selectedPreset.set(FDOG_STYLE_PRESETS[name] ?? null);
  }

  onConfig(config: WireDoGConfig) {
    // Merge the base DoG params + thresholdStrategy descriptor (from the
    // nested <dog> component) with the FDoG extras.
    const fdogConfig: WireFDoGConfig = {
      ...config,
      sigmaC: this.sigmaC.value,
      sigmaM: this.sigmaM.value,
      sigmaA: this.sigmaA.value,
    };
    this.config.set(fdogConfig);
  }

  toModel(): FDogConfig {
    return { kind: 'config', type: 'fdog', config: this.config() };
  }
}