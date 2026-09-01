import { Component, input, output, computed, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';

/**
 * Visualizes hysteresis's highOffset/lowOffset as a band straddling a fixed
 * epsilon marker, instead of two disconnected number fields. The low thumb
 * only ever ranges over [trackMin, epsilon]; the high thumb only ranges over
 * [epsilon, trackMax] -- so "offset can't be negative" falls directly out of
 * each thumb's own min/max rather than needing separate validation.
 *
 * Not a ControlValueAccessor: unlike param-slider this drives two
 * independent values (highOffset/lowOffset) rather than one, so it's wired
 * up with plain inputs/outputs instead. `committed` mirrors param-slider's
 * event of the same name (thumb released / number field blurred).
 */
@Component({
  selector: 'hysteresis-band-slider',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './hysteresis-band-slider.html',
  styleUrl: './hysteresis-band-slider.scss',
})
export class HysteresisBandSliderComponent {
  // Domain the band lives in. In practice this is epsilon's own hard range
  // (ranges().epsilon.hardMin/hardMax) since highOffset/lowOffset are
  // distances from epsilon within that same normalized space.
  trackMin = input.required<number>();
  trackMax = input.required<number>();
  step = input<number>(0.01);

  // Null (or epsilonVariesPerPixel = true) when epsilon is itself computed
  // per pixel: there is then no single true epsilon to anchor on, so the
  // component falls back to a schematic center purely to position the two
  // thumbs, and switches its readouts from absolute numbers to symbolic
  // "epsilon +/- offset" text -- see anchor()/isSchematic().
  epsilon = input<number | null>(null);
  epsilonVariesPerPixel = input<boolean>(false);
  highOffset = input.required<number>();
  lowOffset = input.required<number>();

  highOffsetChange = output<number>();
  lowOffsetChange = output<number>();
  committed = output<void>();

  // Live (uncommitted) drag state, so the band and number fields track the
  // thumb mid-drag without waiting for the parent to round-trip a new
  // highOffset()/lowOffset() input -- same idea as param-slider's `value`.
  private liveHigh = signal<number | null>(null);
  private liveLow = signal<number | null>(null);

  displayHighOffset = computed(() => this.liveHigh() ?? this.highOffset());
  displayLowOffset = computed(() => this.liveLow() ?? this.lowOffset());

  // True whenever there's no real epsilon to show: either the caller
  // explicitly said so, or didn't supply one at all.
  isSchematic = computed(() => this.epsilonVariesPerPixel() || this.epsilon() == null);

  // The value thumbs are positioned around. When schematic, this is just
  // the track midpoint -- a layout convenience, not a claim about any
  // actual epsilon.
  anchor = computed(() => {
    const e = this.epsilon();
    return this.isSchematic() || e == null ? (this.trackMin() + this.trackMax()) / 2 : e;
  });

  lowBound = computed(() =>
    HysteresisBandSliderComponent.clamp(
      this.anchor() - this.displayLowOffset(),
      this.trackMin(),
      this.anchor()
    )
  );
  highBound = computed(() =>
    HysteresisBandSliderComponent.clamp(
      this.anchor() + this.displayHighOffset(),
      this.anchor(),
      this.trackMax()
    )
  );

  lowPercent = computed(() => this.toPercent(this.lowBound()));
  highPercent = computed(() => this.toPercent(this.highBound()));
  epsilonPercent = computed(() => this.toPercent(this.anchor()));

  private toPercent(v: number): number {
    const min = this.trackMin();
    const max = this.trackMax();
    if (max === min) return 0;
    return ((v - min) / (max - min)) * 100;
  }

  private static clamp(v: number, min: number, max: number): number {
    return Math.min(Math.max(v, min), max);
  }

  onLowDrag(raw: string): void {
    const bound = Number(raw);
    if (Number.isNaN(bound)) return;
    const offset = HysteresisBandSliderComponent.clamp(
      this.anchor() - bound,
      0,
      this.anchor() - this.trackMin()
    );
    this.liveLow.set(offset);
    this.lowOffsetChange.emit(offset);
  }

  onHighDrag(raw: string): void {
    const bound = Number(raw);
    if (Number.isNaN(bound)) return;
    const offset = HysteresisBandSliderComponent.clamp(
      bound - this.anchor(),
      0,
      this.trackMax() - this.anchor()
    );
    this.liveHigh.set(offset);
    this.highOffsetChange.emit(offset);
  }

  onLowNumberInput(raw: string): void {
    const offset = Number(raw);
    if (Number.isNaN(offset)) return;
    const clamped = HysteresisBandSliderComponent.clamp(offset, 0, this.anchor() - this.trackMin());
    this.liveLow.set(clamped);
    this.lowOffsetChange.emit(clamped);
  }

  onHighNumberInput(raw: string): void {
    const offset = Number(raw);
    if (Number.isNaN(offset)) return;
    const clamped = HysteresisBandSliderComponent.clamp(offset, 0, this.trackMax() - this.anchor());
    this.liveHigh.set(clamped);
    this.highOffsetChange.emit(clamped);
  }

  onCommitLow(): void {
    this.liveLow.set(null);
    this.committed.emit();
  }

  onCommitHigh(): void {
    this.liveHigh.set(null);
    this.committed.emit();
  }
}