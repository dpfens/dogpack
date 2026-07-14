import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SourceImageService {
  private readonly _image = signal<ImageData | null>(null);
  private readonly _error = signal<string | null>(null);

  /** null until an image has been loaded. */
  readonly image = this._image.asReadonly();
  readonly error = this._error.asReadonly();

  /** Decode a picked/dropped file into ImageData and store it. */
  loadFile(file: File): void {
    if (!file.type.startsWith('image/')) {
      this._error.set('Please choose an image file.');
      return;
    }
    this._error.set(null);

    const reader = new FileReader();

    reader.onerror = () => this._error.set('Could not read that file.');

    reader.onload = () => {
      const img = new Image();

      img.onerror = () => this._error.set('Could not decode that file as an image.');

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
        this._image.set(ctx.getImageData(0, 0, canvas.width, canvas.height));
      };

      img.src = reader.result as string;
    };

    reader.readAsDataURL(file);
  }

  /** Back to the landing screen. */
  reset(): void {
    this._image.set(null);
    this._error.set(null);
  }
}