import {
  Component,
  input,
  output,
  computed,
  signal,
  effect,
  untracked,
  inject,
} from '@angular/core';
import {
  ReactiveFormsModule,
  FormGroup,
  FormControl,
  Validators,
} from '@angular/forms';
import { ParamRange, DogConfigParamType, ChannelImage } from 'dogpack';
import { parameterEstimation } from 'dogpack/preprocess';
import { ThresholdStrategyDescriptor, ThresholdType, WireDoGConfig } from '../../../models/dog';
import { ParamSliderComponent } from '../../ui/param-slider-component/param-slider-component';
import { ImageCanvasComponent, ImageStatus } from '../../ui/image-canvas/image-canvas';
import {
  DOG_PARAM_HINTS,
  THRESHOLD_STRATEGIES,
  HYSTERESIS_PARAM_HINTS,
  findThresholdStrategy,
  withRange,
} from '../../content/pipeline-help-content';
import { luminanceToImageData } from 'dogpack/utils';
import { DoGService } from '../../../services/dog/dog-service';

const THRESHOLD_TYPE_TO_DESCRIPTOR_KIND: Record<ThresholdType, ThresholdStrategyDescriptor['kind']> = {
  Soft: 'soft',
  Hard: 'hard',
  Hysteresis: 'hysteresis',
};

type DogFormControls = {
  [K in DogConfigParamType]: FormControl<number>;
} & {
  strategyKey: FormControl<ThresholdType>;
  highOffset: FormControl<number>;
  lowOffset: FormControl<number>;
  contrastMargin: FormControl<number>;
};

@Component({
  selector: 'dog',
  standalone: true,
  imports: [ReactiveFormsModule, ParamSliderComponent, ImageCanvasComponent],
  templateUrl: './dog.html',
})
export class DogComponent {
  dog = inject(DoGService);
  ranges = input.required<Record<DogConfigParamType, ParamRange>>();

  allowAutoEpsilon = input<boolean>(true);
  preset = input<Partial<WireDoGConfig> | null>(null);
  sourceChannel = this.dog.workingImage;
  configChange = output<WireDoGConfig>();

  strategyOptions = THRESHOLD_STRATEGIES.map(({ key, label }) => ({ key, label }));

  private paramKeys: DogConfigParamType[] = ['sigma', 'k', 'p', 'epsilon', 'phi'];

  readonly form: FormGroup<DogFormControls> = this.buildForm();

  private strategyValue = signal<ThresholdType>(this.form.controls.strategyKey.value);

  isHysteresis = computed(() => this.strategyValue() === 'Hysteresis');

  epsilonAuto = signal(false);

  /** Last computed auto-epsilon map (null until computed / when manual). */
  private epsilonPreview = signal<ChannelImage | null>(null);
  epsilonPreviewStatus = signal<ImageStatus>('idle');
  epsilonPreviewImageData = computed(() => {
    const img = this.epsilonPreview();
    return img ? luminanceToImageData(img) : null;
  });

  /** Description shown under the "Threshold strategy" <select>. */
  readonly strategyHint = computed(
    () => findThresholdStrategy(this.strategyValue())?.hint ?? ''
  );

  /** highOffset/lowOffset aren't in `ranges()` (they're plain FormControls
   * with a hardcoded min, not ParamRange-backed), so they get their own
   * lookup instead of going through hint(). */
  hysteresisHint(key: 'highOffset' | 'lowOffset'): string {
    return HYSTERESIS_PARAM_HINTS[key].hint;
  }

  /** contrastMargin isn't a ranges()-backed param (no ParamRange for it), so
   * like hysteresisHint() it gets a static lookup instead of hint(). */
  private readonly CONTRAST_MARGIN_HINT =
    'Suppresses fine texture and noise while leaving strong edges alone, by scaling the required ' +
    'deviation from the local baseline to local contrast instead of a flat margin. 0 disables it ' +
    '(plain local-baseline epsilon); try 0.25-1.5 to start.';

  contrastMarginHint(): string {
    return this.CONTRAST_MARGIN_HINT;
  }

  constructor() {
    this.form.controls.strategyKey.valueChanges.subscribe((v) =>
      this.strategyValue.set(v)
    );
  }

  __validation_sync__ = effect(() => {
    const r = this.ranges();
    for (const key of this.paramKeys) {
      const c = this.form.controls[key];
      c.setValidators([
        Validators.required,
        Validators.min(r[key].hardMin),
        Validators.max(r[key].hardMax),
      ]);
      c.updateValueAndValidity({ emitEvent: false });
    }
  });

  __epsilon_auto_sync__ = effect(() => {
    const auto = this.epsilonAuto();
    const src = this.sourceChannel();
    untracked(() => {
      if (auto) {
        this.form.controls.epsilon.disable({ emitEvent: false });
        this.form.controls.contrastMargin.enable({ emitEvent: false });
        this.recomputeEpsilonAutoIfNeeded();
      } else {
        this.form.controls.epsilon.enable({ emitEvent: false });
        this.form.controls.contrastMargin.disable({ emitEvent: false });
        this.epsilonPreview.set(null);
        this.epsilonPreviewStatus.set('idle');
        this.emitIfValid();
      }
    });
  });

  private initialEmitDone = false;

  __on_input = effect(() => {
    const p = this.preset();
    untracked(() => {
      if (p) {
        this.applyPreset(p);
      }
      if (!this.initialEmitDone) {
        this.initialEmitDone = true;
        this.emitIfValid();
      }
    });
  });

  private buildForm(): FormGroup<DogFormControls> {
    const num = (v: number) =>
      new FormControl<number>(v, {
        nonNullable: true,
        validators: [Validators.required],
      });

    return new FormGroup<DogFormControls>({
      sigma: num(1.0),
      k: num(1.6),
      p: num(20),
      epsilon: num(0.5),
      phi: num(10),
      strategyKey: new FormControl<ThresholdType>('Soft', { nonNullable: true }),
      highOffset: new FormControl<number>(0.2, {
        nonNullable: true,
        validators: [Validators.required, Validators.min(0)],
      }),
      lowOffset: new FormControl<number>(0.2, {
        nonNullable: true,
        validators: [Validators.required, Validators.min(0)],
      }),
      contrastMargin: new FormControl<number>(0, {
        nonNullable: true,
        validators: [Validators.required, Validators.min(0), Validators.max(5)],
      }),
    });
  }

  private applyPreset(p: Partial<WireDoGConfig>): void {
    const patch: Partial<Record<DogConfigParamType, number>> = {};
    for (const key of this.paramKeys) {
      const val = p[key];
      if (typeof val === 'number') {
        patch[key] = val;
      }
    }
    this.form.patchValue(patch);
  }

  recMax(key: DogConfigParamType): number {
    const r = this.ranges()[key];
    if (r.recommendedMax === Infinity) {
      return isFinite(r.hardMax) ? r.hardMax : r.recommendedMin * 10;
    }
    return r.recommendedMax;
  }

  recMin(key: DogConfigParamType): number {
    return this.ranges()[key].recommendedMin;
  }

  hint(key: DogConfigParamType): string {
    return withRange(DOG_PARAM_HINTS[key].hint, this.ranges()[key]);
  }

  onEpsilonAutoToggle(checked: boolean): void {
    this.epsilonAuto.set(checked);
  }

  /**
   * Builds a wire-safe descriptor, NOT a live ThresholdStrategy instance --
   * this crosses to the worker eventually via configChange -> the parent's
   * onConfig -> toModel() -> postMessage. Reconstructed worker-side in
   * createThresholdStrategy (executor dog.ts).
   */
  private buildThresholdStrategyDescriptor(f: FormGroup<DogFormControls>): ThresholdStrategyDescriptor {
    const kind = THRESHOLD_TYPE_TO_DESCRIPTOR_KIND[f.controls.strategyKey.value];
    if (kind === 'hysteresis') {
      return {
        kind,
        highOffset: f.controls.highOffset.value,
        lowOffset: f.controls.lowOffset.value,
      };
    }
    return { kind };
  }

  /**
   * Called whenever a control is "committed": a param-slider's range
   * thumb is released or its number field is blurred, a hysteresis
   * offset field is blurred, or the threshold strategy is changed.
   * Applies the config immediately -- there's no separate Apply step.
   *
   * If epsilon is in auto mode, sigma is the only committed value that
   * could have changed the estimate (k/p/phi/threshold don't feed
   * localBaselineEstimate), so this also re-triggers it. Recomputing on
   * every commit rather than on every live drag tick keeps a full-image
   * blur off the hot path while still tracking sigma tightly enough.
   */
  onCommit(): void {
    this.emitIfValid();
    this.recomputeEpsilonAutoIfNeeded();
  }

  private epsilonComputeToken = 0;

  private recomputeEpsilonAutoIfNeeded(): void {
    if (!this.epsilonAuto()) return;

    const src = this.sourceChannel();
    if (!src) {
      this.epsilonPreview.set(null);
      this.epsilonPreviewStatus.set('idle');
      return;
    }

    const sigma = this.form.controls.sigma.value;
    const contrastMargin = this.form.controls.contrastMargin.value;
    const token = ++this.epsilonComputeToken;
    this.epsilonPreviewStatus.set('loading');

    parameterEstimation.epsilon.localBaselineEstimate(src, { sigma, contrastMargin })
      .then((result) => {
        if (token !== this.epsilonComputeToken) return;
        this.epsilonPreview.set(result);
        this.epsilonPreviewStatus.set('ready');
        this.emitIfValid();
      })
      .catch(() => {
        if (token !== this.epsilonComputeToken) return;
        this.epsilonPreview.set(null);
        this.epsilonPreviewStatus.set('error');
      });
  }

  private emitIfValid(): void {
    if (this.form.invalid) return;
    if (this.epsilonAuto() && !this.epsilonPreview()) return;

    const v = this.form.getRawValue();
    this.configChange.emit({
      sigma: v.sigma,
      k: v.k,
      p: v.p,
      epsilon: this.epsilonAuto() ? this.epsilonPreview()! : v.epsilon,
      phi: v.phi,
      thresholdStrategy: this.buildThresholdStrategyDescriptor(this.form),
    });
  }
}