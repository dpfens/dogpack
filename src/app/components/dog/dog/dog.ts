import {
  Component,
  input,
  output,
  computed,
  signal,
  effect,
  untracked,
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
};

@Component({
  selector: 'dog',
  standalone: true,
  imports: [ReactiveFormsModule, ParamSliderComponent],
  templateUrl: './dog.html',
})
export class DogComponent {
  ranges = input.required<Record<DogConfigParamType, ParamRange>>();

  preset = input<Partial<WireDoGConfig> | null>(null);

  // Wire type -- no ThresholdStrategy instance lives on this event.
  configChange = output<WireDoGConfig>();

  strategyOptions: { key: ThresholdType; label: string }[] = [
    { key: 'Soft', label: 'Soft' },
    { key: 'Hard', label: 'Hard' },
    { key: 'Hysteresis', label: 'Hysteresis' },
  ];

  private paramKeys: DogConfigParamType[] = ['sigma', 'k', 'p', 'epsilon', 'phi'];

  readonly form: FormGroup<DogFormControls> = this.buildForm();

  private strategyValue = signal<ThresholdType>(this.form.controls.strategyKey.value);

  isHysteresis = computed(() => this.strategyValue() === 'Hysteresis');

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

  private initialEmitDone = false;

  /**
   * Applies the preset (if any) then, on this same first run, emits once
   * so the parent immediately gets a valid config -- either the preset's
   * values or, if no preset was given, the form's defaults. Only ever
   * fires this initial emit once; later preset changes still just patch
   * the form and wait for a user commit like everything else.
   */
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
    const r = this.ranges()[key];
    const max = r.recommendedMax === Infinity ? '∞' : r.recommendedMax;
    return `recommended ${r.recommendedMin}–${max}`;
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
      p: v.p,
      epsilon: v.epsilon,
      phi: v.phi,
      thresholdStrategy: this.buildThresholdStrategyDescriptor(this.form),
    });
  }
}