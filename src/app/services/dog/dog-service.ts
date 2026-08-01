import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { TypedWorkerClient } from '../worker/worker-client';
import { DogLayer, DogNode, DogNodeKind, DogRunRequest, isLayer } from '../../models/dog';
import { WorkerService } from '../worker/worker-service';
import { ChannelImage } from 'dogpack';

/** Identifies which node currently "owns" the shared canvas, for a label/header. */
export interface DogFocusLabel {
  kind: DogNodeKind;
  /** e.g. a layer's `name` signal value. Purely cosmetic. */
  name?: string;
}

@Injectable({ providedIn: 'root' })
export class DoGService implements OnDestroy {
  private workerService = inject(WorkerService);
  private client: TypedWorkerClient<DogRunRequest, ChannelImage> | null =
    this.workerService.isSupported
      ? this.workerService.create(() => new Worker(new URL('./dog.worker', import.meta.url)))
      : null;

  private readonly _activeImage = signal<ImageData | null>(null);
  private readonly _activeLabel = signal<DogFocusLabel | null>(null);
  private readonly _pending = signal(false);

  readonly activeImage = this._activeImage.asReadonly();
  readonly activeLabel = this._activeLabel.asReadonly();
  readonly pending = this._pending.asReadonly();

  /** Call right before starting a run, so the canvas can show a loading state. */
  setPending(label: DogFocusLabel): void {
    this._activeLabel.set(label);
    this._pending.set(true);
  }

  /** Call with the result once a run resolves. */
  show(label: DogFocusLabel, image: ImageData): void {
    this._activeLabel.set(label);
    this._activeImage.set(image);
    this._pending.set(false);
  }

  private readonly _workingImage = signal<ChannelImage | null>(null);

  readonly workingImage = this._workingImage.asReadonly();

  /** Call once preprocessing (or any step upstream of the DoG tree) produces a result. */
  setWorkingImage(image: ChannelImage): void {
    this._workingImage.set(image);
  }

  /**
   * Runs `node` against an image.
   *
   * By default reads the shared `workingImage` signal - this is what
   * every interactive "Preview"/"Run" button in the UI relies on, since
   * they don't have their own image handy and expect to read whatever
   * PreprocessingComponent last wrote there.
   *
   * Pass `image` explicitly to bypass `workingImage` entirely - e.g. a
   * batch/per-frame caller (video export) that has its own image for
   * this call and must NOT perturb the shared slot the interactive
   * preview depends on. See WorkbenchComponent.runFrameThroughPipeline().
   */
  async run(node: DogNode, image: ChannelImage): Promise<ChannelImage | undefined> {
    if (!this.client) {
      return undefined;
    }
    const layer: DogLayer = isLayer(node)
      ? node
      : { kind: 'layer', name: node.type, blendMode: 'blendAverage', components: [node] };
    return await this.client.postMessage({ layer, image });
  }

  ngOnDestroy(): void {
    this.client?.terminate();
  }
}