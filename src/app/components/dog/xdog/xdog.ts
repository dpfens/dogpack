import { Component, input, model, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { DoGConfig, DogConfigParamType, ParamRange, STYLE_PRESETS, XDOG_PARAM_RANGES, XDogConfigParamType } from 'dogpack/dog';
import { DogComponent } from '../dog/dog';
import { BlurStrategyDescriptor, WireDoGConfig, XDogConfig, XDogPreset } from '../../../models/dog';
import { ParamSliderComponent } from "../../ui/param-slider-component/param-slider-component";
import { DogPreviewableComponent } from '../base';
import { DogFocusLabel } from '../../../services/dog/dog-service';

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
export class XDogComponent extends DogPreviewableComponent<XDogConfig> {
  readonly paramRanges: Record<DogConfigParamType | XDogConfigParamType, ParamRange> = XDOG_PARAM_RANGES;

  readonly config = model<XDogConfig>({} as XDogConfig);
  readonly presetNames = Object.keys(STYLE_PRESETS);
  readonly selectedPreset = signal<XDogPreset | null>(null);
  preset = input<XDogPreset | null>(null);

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

  protected focusLabel(): DogFocusLabel {
    return { kind: 'xdog' };
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
    return this.config();
  }
}