import { Component, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  DogConfigParamType,
  FDOG_CONFIDENCE_WEIGHT_PARAM_RANGES,
  FDOG_PARAM_RANGES,
  FDOG_STYLE_PRESETS,
  FDoGConfidenceWeightingConfig,
  FDogConfigParamType,
  ParamRange,
} from 'dogpack/dog';
import { DogComponent } from '../dog/dog';
import { ParamSliderComponent } from '../../ui/param-slider-component/param-slider-component';
import { FDogConfig, FDogPreset, WireDoGConfig, WireFDoGConfig } from '../../../models/dog';
import { DogPreviewableComponent } from '../base';
import { DogFocusLabel } from '../../../services/dog/dog-service';
import { FDOG_EXTRA_PARAM_HINTS, withRange } from '../../content/pipeline-help-content';

@Component({
  selector: 'fdog',
  imports: [DogComponent, ReactiveFormsModule, ParamSliderComponent],
  templateUrl: './fdog.html',
  styleUrl: './fdog.scss',
  providers: [],
})
export class FDogComponent extends DogPreviewableComponent<FDogConfig> {

  readonly paramRanges: Record<DogConfigParamType | FDogConfigParamType, ParamRange> =
    FDOG_PARAM_RANGES;

  readonly config = model<WireFDoGConfig>({} as WireFDoGConfig);

  // Latest base config emitted by the nested <dog> component (its own
  // params + thresholdStrategy descriptor). null until <dog> has emitted at
  // least once. Kept separate from `config` so the merge below can re-run
  // whenever *any* local control changes, not just when <dog> emits.
  private baseConfig = signal<WireDoGConfig | null>(null);

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

  // Signal views of the FormControls above, so the merge effect below can
  // react to them the same way it reacts to signals like
  // confidenceWeightingEnabled. FormControl.valueChanges is an Observable,
  // not a signal, so effect() can't see it directly without this.
  private sigmaCValue = toSignal(this.sigmaC.valueChanges, { initialValue: this.sigmaC.value });
  private sigmaMValue = toSignal(this.sigmaM.valueChanges, { initialValue: this.sigmaM.value });
  private sigmaAValue = toSignal(this.sigmaA.valueChanges, { initialValue: this.sigmaA.value });

  // --- Confidence weighting -------------------------------------------------
  // Opt-in: the wire config only carries a `confidenceWeighting` object when
  // this is enabled. Sub-fields default to the library's own defaults
  // (epsilonMargin 0.15, the three booleans true) once turned on.
  readonly confidenceWeightingEnabled = signal<boolean>(false);

  // epsilonMargin has its own range set (FDOG_CONFIDENCE_WEIGHT_PARAM_RANGES),
  // separate from FDOG_PARAM_RANGES/paramRanges (sigmaC/M/A), reflecting that
  // it's a confidence-weighting sub-field, not a top-level FDoG param.
  readonly confidenceWeightRanges = FDOG_CONFIDENCE_WEIGHT_PARAM_RANGES;
  readonly epsilonMargin = new FormControl<number>(this.confidenceWeightRanges.epsilonMargin.default, {
    nonNullable: true,
    validators: [
      Validators.required,
      Validators.min(this.confidenceWeightRanges.epsilonMargin.hardMin),
      Validators.max(this.confidenceWeightRanges.epsilonMargin.hardMax),
    ],
  });
  readonly sigmaMBlend = new FormControl<boolean>(true, { nonNullable: true });
  readonly sigmaABlend = new FormControl<boolean>(true, { nonNullable: true });
  readonly pByMagnitude = new FormControl<boolean>(true, { nonNullable: true });

  private epsilonMarginValue = toSignal(this.epsilonMargin.valueChanges, { initialValue: this.epsilonMargin.value });
  private sigmaMBlendValue = toSignal(this.sigmaMBlend.valueChanges, { initialValue: this.sigmaMBlend.value });
  private sigmaABlendValue = toSignal(this.sigmaABlend.valueChanges, { initialValue: this.sigmaABlend.value });
  private pByMagnitudeValue = toSignal(this.pByMagnitude.valueChanges, { initialValue: this.pByMagnitude.value });

  // Selected preset drives both the DoG params (via <dog [preset]>) and the
  // FDoG extras (via the effect below). null = "Custom".
  readonly presetNames = Object.keys(FDOG_STYLE_PRESETS);
  readonly selectedPreset = signal<FDogPreset | null>(null);
  preset = input<FDogPreset | null>(null);
  private effectivePreset = computed(() => this.preset() ?? this.selectedPreset());

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
      if (p.confidenceWeighting) {
        const cw = p.confidenceWeighting;
        this.confidenceWeightingEnabled.set(true);
        if (typeof cw.epsilonMargin === 'number') this.epsilonMargin.setValue(cw.epsilonMargin);
        if (typeof cw.sigmaMBlend === 'boolean') this.sigmaMBlend.setValue(cw.sigmaMBlend);
        if (typeof cw.sigmaABlend === 'boolean') this.sigmaABlend.setValue(cw.sigmaABlend);
        if (typeof cw.pByMagnitude === 'boolean') this.pByMagnitude.setValue(cw.pByMagnitude);
      } else {
        this.confidenceWeightingEnabled.set(false);
      }
    });
  });

  // Recomputes `config` whenever the base config from <dog> OR any local
  // control (sigmaC/M/A, the confidence-weighting toggle, or any of its
  // sub-controls) changes. This is the single source of truth for `config`
  // -- onConfig() below only updates `baseConfig`, it no longer builds the
  // merged config itself, so no interaction path gets missed.
  __sync_config__ = effect(() => {
    const base = this.baseConfig();
    const sigmaC = this.sigmaCValue();
    const sigmaM = this.sigmaMValue();
    const sigmaA = this.sigmaAValue();
    const cwEnabled = this.confidenceWeightingEnabled();
    const epsilonMargin = this.epsilonMarginValue();
    const sigmaMBlend = this.sigmaMBlendValue();
    const sigmaABlend = this.sigmaABlendValue();
    const pByMagnitude = this.pByMagnitudeValue();

    if (!base) return;

    const fdogConfig: WireFDoGConfig = {
      ...base,
      sigmaC,
      sigmaM,
      sigmaA,
      ...(cwEnabled
        ? {
            confidenceWeighting: {
              epsilonMargin,
              sigmaMBlend,
              sigmaABlend,
              pByMagnitude,
            } satisfies FDoGConfidenceWeightingConfig,
          }
        : {}),
    };
    this.config.set(fdogConfig);
  });

  protected focusLabel(): DogFocusLabel {
    return { kind: 'fdog' };
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

  hint(key: FDogConfigParamType): string {
    return withRange(FDOG_EXTRA_PARAM_HINTS[key].hint, this.paramRanges[key]);
  }

  selectPreset(name: string): void {
    this.selectedPreset.set(FDOG_STYLE_PRESETS[name] ?? null);
    if (name) this.analytics.trackDogPresetSelected('fdog', name);
  }

  toggleConfidenceWeighting(enabled: boolean): void {
    this.confidenceWeightingEnabled.set(enabled);
  }

  onConfig(config: WireDoGConfig) {
    // Base DoG params + thresholdStrategy descriptor, from the nested <dog>
    // component. The actual merge into `config` happens in __sync_config__
    // above, which also reacts to the local FDoG-only controls.
    this.baseConfig.set(config);
  }

  toModel(): FDogConfig {
    return { kind: 'config', type: 'fdog', config: this.config() };
  }
}