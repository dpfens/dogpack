import {
  Component, ElementRef, viewChild, input, effect, afterNextRender,
  signal, DestroyRef, inject, computed,
} from '@angular/core';

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

  private hostRef = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private ctx?: CanvasRenderingContext2D;
  private destroyRef = inject(DestroyRef);

  private containerSize = signal({ width: 0, height: 0 });
  private scale = signal(1);
  private offset = signal({ x: 0, y: 0 });
  comparePos = signal(50); // percent

  private panning = false;
  private draggingDivider = false;
  private panStart = { x: 0, y: 0 };
  private offsetStart = { x: 0, y: 0 };

  cursorStyle = computed(() => (this.scale() > 1 ? 'grab' : 'default'));

  constructor() {
    afterNextRender(() => {
      this.ctx = this.canvasRef().nativeElement.getContext('2d')!;
      const ro = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        this.containerSize.set({ width, height });
      });
      ro.observe(this.hostRef().nativeElement);
      this.destroyRef.onDestroy(() => ro.disconnect());
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

  private draw(
    imageData: ImageData, compareWith: ImageData | null,
    size: { width: number; height: number }, fit: 'contain' | 'cover',
    userScale: number, userOffset: { x: number; y: number }, comparePct: number,
  ) {
    const canvas = this.canvasRef().nativeElement;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;

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

    const after = this.toOffscreen(imageData);

    if (compareWith) {
      const before = this.toOffscreen(compareWith);
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

  private toOffscreen(imageData: ImageData): OffscreenCanvas {
    const off = new OffscreenCanvas(imageData.width, imageData.height);
    off.getContext('2d')!.putImageData(imageData, 0, 0);
    return off;
  }

  onWheel(event: WheelEvent) {
    if (!this.zoomEnabled()) return;
    event.preventDefault();
    const delta = -event.deltaY * 0.001;
    this.scale.update(s => Math.min(5, Math.max(1, s + s * delta)));
  }

  onPanStart(event: PointerEvent) {
    if (this.draggingDivider) return;
    this.panning = true;
    this.panStart = { x: event.clientX, y: event.clientY };
    this.offsetStart = this.offset();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
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
  }

  onDividerStart(event: PointerEvent) {
    event.stopPropagation();
    this.draggingDivider = true;
  }

  resetView() {
    this.scale.set(1);
    this.offset.set({ x: 0, y: 0 });
  }
}