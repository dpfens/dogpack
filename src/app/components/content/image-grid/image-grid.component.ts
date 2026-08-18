import {
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  AfterViewInit,
  SimpleChanges,
  ViewChild,
  PLATFORM_ID,
  Inject,
  effect,
  Signal,
  input,
  WritableSignal,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ProcessingExample } from '../../../models/content';

@Component({
  selector: 'app-image-grid',
  templateUrl: './image-grid.component.html',
  styleUrls: ['./image-grid.component.scss'],
})
export class ImageGridComponent implements AfterViewInit, OnChanges, OnDestroy {
  examples = input<ProcessingExample[]>([]);

  @ViewChild('gridEl', { static: true }) gridEl!: ElementRef<HTMLDivElement>;

  cols: WritableSignal<number> = signal(1);
  rows: WritableSignal<number> = signal(1);

  private resizeObserver?: ResizeObserver;
  private viewReady = false;
  private isBrowser: boolean;

  // Reveal-wipe timing tuning. Tiles are desynced from one another so the
  // grid doesn't pulse in unison
  private static readonly WIPE_MIN_DURATION_S = 10;
  private static readonly WIPE_DURATION_RANGE_S = 2;
  private static readonly GOLDEN_RATIO_CONJUGATE = 0.61803398875;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
    effect(() => {
      this.examples(); // read to register dependency
      if (this.viewReady) {
        this.recalculate();
      }
    });
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;

    this.viewReady = true;
    this.recalculate();

    this.resizeObserver = new ResizeObserver(() => this.recalculate());
    this.resizeObserver.observe(this.gridEl.nativeElement);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['examples'] && this.viewReady) {
      this.recalculate();
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  recalculate(): void {
    if (!this.isBrowser) return;

    const el = this.gridEl?.nativeElement;
    if (!el || typeof el.getBoundingClientRect !== 'function') return;

    const { width, height } = el.getBoundingClientRect();
    const count = this.examples().length;
    if (!width || !height || count === 0) {
      this.cols.set(1);
      this.rows.set(1);
      return;
    }

    const containerRatio = width / height;
    this.cols.set(Math.max(1, Math.round(Math.sqrt(count * containerRatio))));
    this.rows.set(Math.max(1, Math.ceil(count / this.cols())));
  }

  wipeDuration(i: number): string {
    return `${this.wipeDurationSeconds(i)}s`;
  }


  wipeDelay(i: number): string {
    const duration = this.wipeDurationSeconds(i);
    const phase = this.pseudoRandom(i, 1) * duration;
    return `-${phase.toFixed(2)}s`;
  }

  private wipeDurationSeconds(i: number): number {
    return (
      ImageGridComponent.WIPE_MIN_DURATION_S +
      this.pseudoRandom(i, 0) * ImageGridComponent.WIPE_DURATION_RANGE_S
    );
  }

  private pseudoRandom(i: number, seed: number): number {
    const x = (i + seed * 0.5) * ImageGridComponent.GOLDEN_RATIO_CONJUGATE;
    return x - Math.floor(x);
  }
}