import { Component, inject, input, model, output, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { DoGConfig, DogConfigParamType, ParamRange, STYLE_PRESETS, XDOG_PARAM_RANGES, XDoGConfig, XDogConfigParamType } from 'dogpack/dog';
import { ChannelImage } from 'dogpack';
import { DogComponent } from '../dog/dog';
import { BlurStrategyDescriptor, DogModelProvider, WireDoGConfig, XDogConfig, XDogPreset } from '../../../models/dog';
import { ParamSliderComponent } from "../../ui/param-slider-component/param-slider-component";
import { DoGService } from '../../../services/dog/dog-service';

type BlurType = 'Isotropic';

// Local UI label -> wire descriptor kind. Extend this alongside blurOptions
// when a second BlurType is added.
const BLUR_TYPE_TO_DESCRIPTOR_KIND: Record<BlurType, BlurStrategyDescriptor['kind']> = {
  Isotropic: 'isotropic',
};

@Component({
  selector: 'xdog',
  imports: [DogComponent, ReactiveFormsModule, ParamSliderComponent],
  templateUrl: './xdog.html',
  styleUrl: './xdog.scss',
  providers: [],
})
export class XDogComponent implements DogModelProvider<XDogConfig> {
  readonly paramRanges: Record<DogConfigParamType | XDogConfigParamType, ParamRange> = XDOG_PARAM_RANGES;

  readonly config = model<XDogConfig>({} as XDogConfig);
  readonly presetNames = Object.keys(STYLE_PRESETS);
  readonly selectedPreset = signal<XDogPreset | null>(null);
  preset = input<XDogPreset | null>(null);

  readonly channelImage = output<ChannelImage>();
  readonly previewPending = signal(false);

  private readonly dogService = inject(DoGService);

  readonly kernelSizeMultiplier = new FormControl<number>(
    this.paramRanges.kernelSizeMultiplier.default,
    {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.min(this.paramRanges.kernelSizeMultiplier.hardMin),
        Validators.max(this.paramRanges.kernelSizeMultiplier.hardMax),
      ],
    },
  );

  readonly blurStrategyKey = signal<BlurType>('Isotropic');

  readonly blurOptions: { key: BlurType; label: string }[] = [
    { key: 'Isotropic', label: 'Isotropic' }
  ];

  async runPreview(): Promise<void> {
    this.previewPending.set(true);
    try {
      const image = await this.dogService.run(this.toModel());
      if (image) this.channelImage.emit(image);
    } finally {
      this.previewPending.set(false);
    }
  }

  /**
   * Builds a wire-safe descriptor, NOT a live BlurStrategy instance. This
   * config crosses to the worker via postMessage, and the worker
   * reconstructs the real IsotropicBlur (or whichever strategy) from this
   * descriptor in createDoGImplementation. Never put a `new IsotropicBlur(...)`
   * instance on `config.blurStrategy` here.
   */
  private buildBlurStrategyDescriptor(): BlurStrategyDescriptor {
    return {
      kind: BLUR_TYPE_TO_DESCRIPTOR_KIND[this.blurStrategyKey()],
      kernelSizeMultiplier: this.kernelSizeMultiplier.value,
    };
  }

  onConfig(config: WireDoGConfig) {
    const xdogConfig: XDogConfig = {
      kind: 'config',
      type: 'xdog',
      config: {
        ...config,
        kernelSizeMultiplier: this.kernelSizeMultiplier.value,
        blurStrategy: this.buildBlurStrategyDescriptor(),
      }
    };

    this.config.set(xdogConfig);
  }

  selectPreset(name: string): void {
    this.selectedPreset.set(STYLE_PRESETS[name] ?? null);
  }

  toModel(): XDogConfig {
    console.log(this.config());
    return this.config();
  }
}