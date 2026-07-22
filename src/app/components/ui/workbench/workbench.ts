import { Component, computed, inject, input } from '@angular/core';

import { ImageCanvasComponent, ImageStatus } from '../image-canvas/image-canvas';
import { PreprocessingComponent } from '../../dog/preprocessing-component/preprocessing-component';
import { DogLayerComponent } from '../../dog/layer/layer';
import { DoGService } from '../../../services/dog/dog-service';

@Component({
  selector: 'app-workbench',
  imports: [ImageCanvasComponent, PreprocessingComponent, DogLayerComponent],
  templateUrl: './workbench.html',
  styleUrl: './workbench.scss',
})
export class WorkbenchComponent {
  private readonly dogService = inject(DoGService);

  /** The untouched image the whole pipeline starts from. */
  readonly sourceImage = input.required<ImageData>();

  /** Whatever was most recently previewed, anywhere in the tree - see DoGService. */
  readonly activeImage = this.dogService.activeImage;
  readonly activeLabel = this.dogService.activeLabel;
  readonly pending = this.dogService.pending;

  readonly canvasStatus = computed<ImageStatus>(() => {
    if (this.pending()) return 'loading';
    return this.activeImage() ? 'ready' : 'idle';
  });

  /**
   * Human-readable header for whatever's currently shown, e.g.
   * "Previewing: XDoG" or "Previewing: Layer 'edges'".
   */
  readonly activeLabelText = computed(() => {
    const label = this.activeLabel();
    if (!label) return null;
    if (label.kind === 'preprocessing') return 'Preprocessing';
    if (label.kind === 'layer') return `Layer${label.name ? ` "${label.name}"` : ''}`;
    return label.kind.toUpperCase();
  });
}