import { Component, inject, signal } from '@angular/core';

import { WorkbenchComponent } from './components/ui/workbench/workbench';
import { SourceImageService } from './services/source-image/source-image-service';

@Component({
  selector: 'app-root',
  imports: [WorkbenchComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class AppComponent {
  private readonly sourceImageService = inject(SourceImageService);

  /** null = show the landing/ornamentation; set = show the workbench. */
  readonly sourceImage = this.sourceImageService.image;
  readonly error = this.sourceImageService.error;

  /** Purely local UI state for the dropzone hover style - doesn't belong in the service. */
  readonly isDragging = signal(false);

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.sourceImageService.loadFile(file);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.sourceImageService.loadFile(file);
    // Allow re-selecting the same file later.
    input.value = '';
  }

  /** Drop back to the landing screen and pick a different image. */
  reset(): void {
    this.sourceImageService.reset();
  }
}