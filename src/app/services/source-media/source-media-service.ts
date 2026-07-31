import { Injectable, inject, signal } from '@angular/core';
import { VideoFrameService } from '../video-frame/video-frame-service';

export interface SourceImage {
  kind: 'image';
  imageData: ImageData;
  width: number;
  height: number;
}

export interface SourceVideo {
  kind: 'video';
  /**
   * The original video file. Deliberately NOT decoded into frames
   * here — see class doc for why. Pass it to `VideoFrameService`
   * (`videoFrames()` / `transformVideo()`) to actually read or
   * process frames.
   */
  file: File;
  width: number;
  height: number;
  /** Total duration in seconds. */
  duration: number;
}

export type SourceMedia = SourceImage | SourceVideo;

/**
 * Loads a picked/dropped file — image or video, one at a time — and
 * exposes it as `media`.
 *
 * Images are fully decoded into ImageData, same as before.
 *
 * Videos are intentionally NOT decoded here. Only their dimensions
 * and duration are probed (cheap, no frame decode), so loading a
 * video stays fast and low-memory regardless of its length. Consumers
 * that need frames should read `media().file` (when `kind === 'video'`)
 * and stream frames via `VideoFrameService.videoFrames()`, or run a
 * per-frame transform via `VideoFrameService.transformVideo()` —
 * rather than this service eagerly decoding every frame into memory
 * the way a naive "just get all the ImageData" approach would.
 */
@Injectable({ providedIn: 'root' })
export class SourceMediaService {
  private readonly videoFrameService = inject(VideoFrameService);

  private readonly _media = signal<SourceMedia | null>(null);
  private readonly _error = signal<string | null>(null);

  /** null until a file has been loaded. */
  readonly media = this._media.asReadonly();
  readonly error = this._error.asReadonly();

  /** Decode/probe a picked/dropped file and store it as `media`. */
  loadFile(file: File): void {
    if (file.type.startsWith('image/')) {
      this.loadImage(file);
      return;
    }

    if (file.type.startsWith('video/')) {
      this.loadVideo(file);
      return;
    }

    this._error.set('Please choose an image or video file.');
  }

  /** Back to the landing screen. */
  reset(): void {
    this._media.set(null);
    this._error.set(null);
  }

  private loadImage(file: File): void {
    this._error.set(null);

    const reader = new FileReader();

    reader.onerror = () => this._error.set('Could not read that file.');

    reader.onload = () => {
      const img = new Image();

      img.onerror = () =>
        this._error.set('Could not decode that file as an image.');

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          this._error.set('Could not read image data.');
          return;
        }

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        this._media.set({
          kind: 'image',
          imageData,
          width: canvas.width,
          height: canvas.height,
        });
      };

      img.src = reader.result as string;
    };

    reader.readAsDataURL(file);
  }

  private loadVideo(file: File): void {
    if (!VideoFrameService.isSupported()) {
      this._error.set("Video isn't supported in this browser.");
      return;
    }

    this._error.set(null);

    this.videoFrameService
      .getVideoDimensions(file)
      .then(({ width, height, duration }) => {
        this._media.set({ kind: 'video', file, width, height, duration });
      })
      .catch(() => {
        this._error.set('Could not read that video file.');
      });
  }
}