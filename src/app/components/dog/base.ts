import { Directive, inject, output, signal } from '@angular/core';
import { ChannelImage } from 'dogpack';
import { luminanceToImageData } from 'dogpack/utils';
import { DogModelProvider, DogNode } from '../../models/dog';
import { DoGService, type DogFocusLabel } from '../../services/dog/dog-service';
import { ApplicationAnalyticsService } from '../../services/analytics/application-analytics.service';

/**
 * Shared "run my model through the worker and report the result" behavior
 * for every previewable DogNode component - each xdog/fdog/adog/hdog leaf,
 * and DogLayerComponent. Extend this instead of re-declaring
 * previewPending/channelImage/runPreview() per component.
 *
 * Every previewable node reports through DoGService's shared focus state
 * (setPending()/show()), not just its own channelImage output, so the
 * Workbench's single shared canvas updates no matter which node in the tree
 * was just previewed - see the class doc comment on DoGService for why that
 * state lives there instead of being threaded through component inputs.
 *
 * Subclasses supply:
 *  - toModel() - already required by DogModelProvider
 *  - focusLabel() - the DogFocusLabel to report while pending and once the
 *    result is in (e.g. { kind: 'xdog' } or { kind: 'layer', name: this.name() })
 */
@Directive()
export abstract class DogPreviewableComponent<T extends DogNode> implements DogModelProvider<T> {
  protected readonly dogService = inject(DoGService);
  protected readonly analytics = inject(ApplicationAnalyticsService);

  /** Same contract every leaf/layer previously declared individually. */
  readonly channelImage = output<ChannelImage>();

  /** True while a preview run is in flight - bind a spinner/disabled state to this. */
  readonly previewPending = signal(false);

  abstract toModel(): T;

  /** Label reported to DoGService's shared focus state while/after this node runs. */
  protected abstract focusLabel(): DogFocusLabel;

  /** Wire this to a "Preview" button in the subclass's template. */
  async runPreview(): Promise<void> {
    this.previewPending.set(true);
    this.dogService.setPending(this.focusLabel());
    const start = performance.now();
    try {
      const image = await this.dogService.run(this.toModel());
      if (image) {
        this.channelImage.emit(image);
        this.dogService.show(this.focusLabel(), luminanceToImageData(image));
      }
    } finally {
      this.previewPending.set(false);
      this.analytics.trackDogPreviewRun(this.focusLabel().kind, performance.now() - start);
    }
  }
}