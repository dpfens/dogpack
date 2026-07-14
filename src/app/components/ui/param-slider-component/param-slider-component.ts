import {
  Component,
  input,
  forwardRef,
  signal,
} from '@angular/core';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
} from '@angular/forms';

@Component({
  selector: 'param-slider',
  standalone: true,
  templateUrl: './param-slider-component.html',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ParamSliderComponent),
      multi: true,
    },
  ],
})
export class ParamSliderComponent implements ControlValueAccessor {
  // Slider track spans the recommended range.
  sliderMin = input.required<number>();
  sliderMax = input.required<number>();
  // Number field permits the full hard range.
  hardMin = input.required<number>();
  hardMax = input.required<number>();
  step = input<number>(0.1);

  protected value = signal<number>(0);
  protected disabled = signal<boolean>(false);

  private onChange: (v: number) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(v: number): void {
    this.value.set(v ?? 0);
  }
  registerOnChange(fn: (v: number) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  protected update(raw: string): void {
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    this.value.set(n);
    this.onChange(n);
  }

  protected touched(): void {
    this.onTouched();
  }
}