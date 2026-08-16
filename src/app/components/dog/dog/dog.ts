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
import { ParamRange, DogConfigParamType } from 'dogpack';
import { ThresholdStrategyDescriptor, ThresholdType, WireDoGConfig } from '../../../models/dog';
import { ParamSliderComponent } from '../../ui/param-slider-component/param-slider-component';
import {
  DOG_PARAM_HINTS,
  THRESHOLD_STRATEGIES,
  HYSTERESIS_PARAM_HINTS,
  findThresholdStrategy,
  withRange,
} from '../../content/pipeline-help-content';
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
  pWeak: FormControl<number>;
  pStrong: FormControl<number>;
  pSmoothingSigma: FormControl<number>;
  phiSoft: FormControl<number>;
  phiHard: FormControl<number>;
  phiSigma: FormControl<number>;
};

@Component({
  selector: 'dog',
  standalone: true,
  imports: [ReactiveFormsModule, ParamSliderComponent],
  templateUrl: './dog.html',
})
export class DogComponent {
  dog = inject(DoGService);
  ranges = input.required<Record<DogConfigParamType, ParamRange>>();
  preset = input<Partial<WireDoGConfig> | null>(null);
  sourceChannel = this.dog.workingImage;
  configChange = output<WireDoGConfig>();

  strategyOptions = THRESHOLD_STRATEGIES.map(({ key, label }) => ({ key, label }));

  private paramKeys: DogConfigParamType[] = ['sigma', 'k', 'p', 'epsilon', 'phi'];

  readonly form: FormGroup<DogFormControls> = this.buildForm();

  private strategyValue = signal<ThresholdType>(this.form.controls.strategyKey.value);

  isHysteresis = computed(() => this.strategyValue() === 'Hysteresis');

  epsilonAuto = signal(false);
  pAuto = signal(false);
  phiAuto = signal(false);

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

  /** Same rationale as contrastMarginHint(): no ParamRange backs this control. */
  private readonly P_SMOOTHING_SIGMA_HINT =
    'Blurs the raw gradient magnitude before normalizing, so p tracks real edge structure instead ' +
    'of single-pixel noise. 0 disables smoothing and uses the raw magnitude.';

  pSmoothingSigmaHint(): string {
    return this.P_SMOOTHING_SIGMA_HINT;
  }

  /** Same rationale as contrastMarginHint(): no ParamRange backs this control. */
  private readonly PHI_SIGMA_HINT =
    'Neighborhood size for the local-variance read that drives phi -- larger values look at a ' +
    'wider area to decide whether a region already has detail worth a harder threshold.';

  phiSigmaHint(): string {
    return this.PHI_SIGMA_HINT;
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

    // pWeak/pStrong are just the endpoints of the same underlying p
    // quantity, so they share its range's bounds.
    for (const c of [this.form.controls.pWeak, this.form.controls.pStrong]) {
      c.setValidators([
        Validators.required,
        Validators.min(r.p.hardMin),
        Validators.max(r.p.hardMax),
      ]);
      c.updateValueAndValidity({ emitEvent: false });
    }

    // phiHard shares phi's full range -- it's meant to reach genuinely
    // steep, near-binary thresholds. phiSoft does NOT: it gets its own
    // (much narrower) static bounds in buildForm(), see the comment
    // there for the derivation.
    this.form.controls.phiHard.setValidators([
      Validators.required,
      Validators.min(r.phi.hardMin),
      Validators.max(r.phi.hardMax),
    ]);
    this.form.controls.phiHard.updateValueAndValidity({ emitEvent: false });
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
      pWeak: num(5),
      pStrong: num(40),
      pSmoothingSigma: new FormControl<number>(1, {
        nonNullable: true,
        validators: [Validators.required, Validators.min(0), Validators.max(20)],
      }),
      // phiSoft's useful range is much narrower than phi's full range:
      // the soft threshold is 1 + tanh(phi * (u - epsilon)), u/epsilon
      // are both normalized to [0,1] so |u - epsilon| <= 1, and tanh
      // saturates (>99.5%) past |z| = 3. So phi = 3 already saturates
      // even the most extreme pixel deviation -- there's no more "soft"
      // behavior to dial in above that. 5 gives headroom off that edge;
      // 10 is a hard cap for manual override, well past the point where
      // anything changes visually.
      phiSoft: new FormControl<number>(0.01, {
        nonNullable: true,
        validators: [Validators.required, Validators.min(0), Validators.max(10)],
      }),
      phiHard: num(50),
      phiSigma: new FormControl<number>(3, {
        nonNullable: true,
        validators: [Validators.required, Validators.min(0.1), Validators.max(50)],
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
    this.onCommit();
  }

  onPAutoToggle(checked: boolean): void {
    this.pAuto.set(checked);
    this.onCommit();
  }

  onPhiAutoToggle(checked: boolean): void {
    this.phiAuto.set(checked);
    this.onCommit();
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
   * Each auto-estimate (epsilon/p/phi) is only recomputed if it's
   * currently in auto mode -- recomputeXAutoIfNeeded() no-ops otherwise --
   * and only depends on that parameter's own inputs (epsilon: sigma +
   * contrastMargin; p: pWeak/pStrong/pSmoothingSigma; phi:
   * phiSoft/phiHard/phiSigma), so calling all three here is cheap and
   * keeps a full-image recompute off the hot path while still tracking
   * every committed change.
   */
  onCommit(): void {
    this.emitIfValid();
  }

  private emitIfValid(): void {
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    this.configChange.emit({
      sigma: v.sigma,
      k: v.k,
      p: this.pAuto()
        ? { mode: 'auto', weak: v.pWeak, strong: v.pStrong, smoothingSigma: v.pSmoothingSigma }
        : v.p,
      epsilon: this.epsilonAuto()
        ? { mode: 'auto', sigma: v.sigma, contrastMargin: v.contrastMargin }
        : v.epsilon,
      phi: this.phiAuto()
        ? { mode: 'auto', soft: v.phiSoft, hard: v.phiHard, sigma: v.phiSigma }
        : v.phi,
      thresholdStrategy: this.buildThresholdStrategyDescriptor(this.form),
    });
  }
}