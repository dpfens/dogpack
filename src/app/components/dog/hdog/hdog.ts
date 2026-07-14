import { Component, computed, effect, inject, model, output, signal, untracked, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  ADOG_PARAM_RANGES,
  FDOG_PARAM_RANGES,
  HDOG_PARAM_RANGES,
  HDOG_STYLE_PRESETS,
  HDogConfigParamType,
  ParamRange,
} from 'dogpack/dog';
import { ChannelImage } from 'dogpack';
import { FDogComponent } from '../fdog/fdog';
import { ADogComponent } from '../adog/adog';
import { ParamSliderComponent } from '../../ui/param-slider-component/param-slider-component';
import { DogModelProvider, HDogConfig, HDogPresetConfig, WireHDoGConfig } from '../../../models/dog';
import { DoGService } from '../../../services/dog/dog-service';

@Component({
  selector: 'hdog',
  imports: [FDogComponent, ADogComponent, ReactiveFormsModule, ParamSliderComponent],
  templateUrl: './hdog.html',
  styleUrl: './hdog.scss',
  providers: [],
})
export class HDogComponent implements DogModelProvider<HDogConfig> {
  readonly fdogRanges = FDOG_PARAM_RANGES;
  readonly adogRanges = ADOG_PARAM_RANGES;
  readonly paramRanges: Record<HDogConfigParamType, ParamRange> = HDOG_PARAM_RANGES;

  readonly config = model<WireHDoGConfig>({} as WireHDoGConfig);

  readonly channelImage = output<ChannelImage>();
  readonly previewPending = signal(false);
  private readonly dogService = inject(DoGService);

  private fdogCmp = viewChild.required(FDogComponent);
  private adogCmp = viewChild.required(ADogComponent);

  readonly adogSecondaryScaleFactor = new FormControl<number>(
    this.paramRanges.adogSecondaryScaleFactor.default,
    {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.min(this.paramRanges.adogSecondaryScaleFactor.hardMin),
        Validators.max(this.paramRanges.adogSecondaryScaleFactor.hardMax),
      ],
    },
  );

  // Presets are plain param bags -- see HDogPresetConfig in models/dog.ts.
  readonly presetNames = Object.keys(HDOG_STYLE_PRESETS);
  readonly selectedPreset = signal<HDogPresetConfig | null>(null);

  readonly fdogPreset = computed(() => this.selectedPreset()?.fdog ?? null);
  readonly adogPreset = computed(() => this.selectedPreset()?.adog ?? null);

  private scaleFactor = signal<number>(this.adogSecondaryScaleFactor.value);

  constructor() {
    this.adogSecondaryScaleFactor.valueChanges.subscribe((v) =>
      this.scaleFactor.set(v)
    );
  }

  __on_preset__ = effect(() => {
    const p = this.selectedPreset();
    if (!p) return;
    untracked(() => {
      if (typeof p.adogSecondaryScaleFactor === 'number') {
        this.adogSecondaryScaleFactor.setValue(p.adogSecondaryScaleFactor);
      }
    });
  });

  __on_nested_change__ = effect(() => {
    const fdog = this.fdogCmp().config();
    const adog = this.adogCmp().config();
    const scale = this.scaleFactor();
    untracked(() => {
      this.config.set({
        fdog,
        adog,
        adogSecondaryScaleFactor: scale,
      });
    });
  });

  async runPreview(): Promise<void> {
    this.previewPending.set(true);
    try {
      const image = await this.dogService.run(this.toModel());
      if (image) this.channelImage.emit(image);
    } finally {
      this.previewPending.set(false);
    }
  }

  selectPreset(name: string): void {
    this.selectedPreset.set(HDOG_STYLE_PRESETS[name] ?? null);
  }

  toModel(): HDogConfig {
    return { kind: 'config', type: 'hdog', config: this.config() };
  }
}