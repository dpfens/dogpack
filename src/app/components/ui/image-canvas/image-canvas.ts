import {
  Component, ElementRef, viewChild, input, effect, afterNextRender,
  signal, DestroyRef, inject, computed,
} from '@angular/core';
import { ApplicationAnalyticsService } from '../../../services/analytics/application-analytics.service';

export type ImageStatus = 'idle' | 'loading' | 'ready' | 'error';

@Component({
  selector: 'app-image-canvas',
  standalone: true,
  templateUrl: 'image-canvas.html',
})
export class ImageCanvasComponent {
  imageData = input<ImageData | null>(null);
  compareWith = input<ImageData | null>(null); // "before" image, enables compare mode
  fit = input<'contain' | 'cover'>('contain');
  status = input<ImageStatus>('ready');
  errorMessage = input<string>('');
  zoomEnabled = input(true);
  downloadEnabled = input(false);
  downloadFilename = input('image.png');

  private hostRef = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private ctx?: CanvasRenderingContext2D;
  private destroyRef = inject(DestroyRef);
  private analytics = inject(ApplicationAnalyticsService);

  /** Guards against firing a zoom event on every wheel tick - only the first
   *  zoom interaction per loaded image is tracked. Reset implicitly whenever
   *  imageData() points at a different ImageData instance. */
  private zoomTrackedForImage: ImageData | null = null;

  private containerSize = signal({ width: 0, height: 0 });
  private scale = signal(1);
  private offset = signal({ x: 0, y: 0 });
  comparePos = signal(50); // percent
  downloading = signal(false);

  private panning = false;
  private draggingDivider = false;
  private panStart = { x: 0, y: 0 };
  private offsetStart = { x: 0, y: 0 };

  private afterCache: { data: ImageData; canvas: OffscreenCanvas } | null = null;
  private beforeCache: { data: ImageData; canvas: OffscreenCanvas } | null = null;

  cursorStyle = computed(() => (this.scale() > 1 ? 'grab' : 'default'));

  constructor() {
    afterNextRender(() => {
      this.ctx = this.canvasRef().nativeElement.getContext('2d')!;
      const ro = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        this.containerSize.set({ width, height });
      });
      const host = this.hostRef().nativeElement;
      ro.observe(host);
      this.destroyRef.onDestroy(() => {
        ro.disconnect();
        this.endWindowDragTracking();
      });
    });

    effect(() => {
      const data = this.imageData();
      const compare = this.compareWith();
      const size = this.containerSize();
      const fitMode = this.fit();
      const s = this.scale();
      const off = this.offset();
      const pos = this.comparePos();
      const st = this.status();

      if (this.ctx && data && st === 'ready' && size.width > 0 && size.height > 0) {
        this.draw(data, compare, size, fitMode, s, off, pos);
      }
    });
  }

  private lastCanvasSize = { w: 0, h: 0 };

  private draw(
    imageData: ImageData, compareWith: ImageData | null,
    size: { width: number; height: number }, fit: 'contain' | 'cover',
    userScale: number, userOffset: { x: number; y: number }, comparePct: number,
  ) {
    const canvas = this.canvasRef().nativeElement;
    const dpr = window.devicePixelRatio || 1;
    const canvasW = Math.round(size.width * dpr);
    const canvasH = Math.round(size.height * dpr);
    if (this.lastCanvasSize.w !== canvasW || this.lastCanvasSize.h !== canvasH) {
      canvas.width = canvasW;
      canvas.height = canvasH;
      this.lastCanvasSize = { w: canvasW, h: canvasH };
    }

    const ctx = this.ctx!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const baseScale = fit === 'contain'
      ? Math.min(canvas.width / imageData.width, canvas.height / imageData.height)
      : Math.max(canvas.width / imageData.width, canvas.height / imageData.height);

    const scale = baseScale * userScale;
    const w = imageData.width * scale;
    const h = imageData.height * scale;
    const x = (canvas.width - w) / 2 + userOffset.x * dpr;
    const y = (canvas.height - h) / 2 + userOffset.y * dpr;

    this.afterCache = this.getOffscreen(imageData, this.afterCache);
    const after = this.afterCache.canvas;

    if (compareWith) {
      this.beforeCache = this.getOffscreen(compareWith, this.beforeCache);
      const before = this.beforeCache.canvas;
      const splitX = (comparePct / 100) * canvas.width;

      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, splitX, canvas.height); ctx.clip();
      ctx.drawImage(before, x, y, w, h);
      ctx.restore();

      ctx.save();
      ctx.beginPath(); ctx.rect(splitX, 0, canvas.width - splitX, canvas.height); ctx.clip();
      ctx.drawImage(after, x, y, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(after, x, y, w, h);
    }
  }

  private getOffscreen(
    imageData: ImageData,
    cache: { data: ImageData; canvas: OffscreenCanvas } | null,
  ): { data: ImageData; canvas: OffscreenCanvas } {
    if (cache && cache.data === imageData) return cache;
    const off = new OffscreenCanvas(imageData.width, imageData.height);
    off.getContext('2d')!.putImageData(imageData, 0, 0);
    return { data: imageData, canvas: off };
  }

  onWheel(event: WheelEvent) {
    if (!this.zoomEnabled()) return;
    event.preventDefault();
    const delta = -event.deltaY * 0.001;
    this.scale.update(s => Math.min(5, Math.max(1, s + s * delta)));

    const current = this.imageData();
    if (current && this.zoomTrackedForImage !== current) {
      this.zoomTrackedForImage = current;
      this.analytics.trackCanvasZoomUsed();
    }
  }

  private windowMoveListener = (event: PointerEvent) => this.onPanMove(event);
  private windowEndListener = (event: PointerEvent) => this.onPanEnd(event);

  private beginWindowDragTracking() {
    // Track the drag via window-level listeners instead of relying on
    // element pointer capture, since capture can be released by the browser
    // as soon as the pointer's coordinates leave the host's bounding box
    // (even with the button still held). window never "loses" the pointer.
    window.addEventListener('pointermove', this.windowMoveListener);
    window.addEventListener('pointerup', this.windowEndListener);
    window.addEventListener('pointercancel', this.windowEndListener);
  }

  private endWindowDragTracking() {
    window.removeEventListener('pointermove', this.windowMoveListener);
    window.removeEventListener('pointerup', this.windowEndListener);
    window.removeEventListener('pointercancel', this.windowEndListener);
  }

  onPanStart(event: PointerEvent) {
    if (this.draggingDivider) return;
    event.preventDefault();
    this.panning = true;
    this.panStart = { x: event.clientX, y: event.clientY };
    this.offsetStart = this.offset();
    this.beginWindowDragTracking();
  }

  onPanMove(event: PointerEvent) {
    if (this.draggingDivider) {
      const rect = this.hostRef().nativeElement.getBoundingClientRect();
      const pct = ((event.clientX - rect.left) / rect.width) * 100;
      this.comparePos.set(Math.min(100, Math.max(0, pct)));
      return;
    }
    if (!this.panning) return;
    const dx = event.clientX - this.panStart.x;
    const dy = event.clientY - this.panStart.y;
    this.offset.set({ x: this.offsetStart.x + dx, y: this.offsetStart.y + dy });
  }

  onPanEnd(event: PointerEvent) {
    this.panning = false;
    this.draggingDivider = false;
    this.endWindowDragTracking();
  }

  onDividerStart(event: PointerEvent) {
    event.stopPropagation();
    event.preventDefault();
    this.draggingDivider = true;
    this.beginWindowDragTracking();
  }

  resetView() {
    this.scale.set(1);
    this.offset.set({ x: 0, y: 0 });
  }

  async downloadImage() {
    const data = this.imageData();
    if (!data || this.status() !== 'ready' || this.downloading()) return;

    this.downloading.set(true);
    try {
      // Reuse the offscreen cache if it's already up to date (it's already at
      // the image's native resolution), otherwise build one on the fly so a
      // download can't be blocked by draw() not having run yet.
      const source = this.afterCache && this.afterCache.data === data
        ? this.afterCache.canvas
        : this.getOffscreen(data, null).canvas;

      const blob = await source.convertToBlob({ type: 'image/png' });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = this.downloadFilename();
        document.body.appendChild(a);
        a.click();
        a.remove();
        this.analytics.trackImageDownloaded();
      } finally {
        URL.revokeObjectURL(url);
      }
    } finally {
      this.downloading.set(false);
    }
  }
}