import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { TypedWorkerClient } from '../worker/worker-client';
import { DogLayer, DogNode, DogRunRequest, isLayer } from '../../models/dog';
import { WorkerService } from '../worker/worker-service';
import { ChannelImage } from 'dogpack';
import { multiScale } from 'dogpack/extensions';

/** Identifies which node currently "owns" the shared canvas, for a label/header. */
export interface DogFocusLabel {
  kind: 'preprocessing' | 'xdog' | 'fdog' | 'adog' | 'hdog' | 'layer';
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

  // --- Shared "what's currently being previewed" state -----------------
  //
  // Any previewable node - PreprocessingComponent, an xdog/fdog/adog/hdog
  // leaf, or a DogLayerComponent at any nesting depth - calls setPending()/
  // show() as it runs its own preview. The Workbench only ever reads these
  // three signals; it doesn't need a reference to whichever component
  // produced them. This lives here rather than in a separate service because
  // it's small and tightly coupled to run() - there's no independent
  // lifecycle or responsibility to justify splitting it out.
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

  // --- Shared "what run() should feed the worker" state -------------------
  //
  // Counterpart to activeImage/activeLabel/pending above, but for input
  // rather than output. PreprocessingComponent sets this once it finishes
  // producing its result - every dog-layer/leaf runPreview() downstream
  // reads whatever's here at call time via run(), rather than each carrying
  // its own copy of the source pixels. Same rationale as above: small,
  // tightly coupled to run(), not worth its own service.
  private readonly _workingImage = signal<ChannelImage | null>(null);

  readonly workingImage = this._workingImage.asReadonly();

  /** Call once preprocessing (or any step upstream of the DoG tree) produces a result. */
  setWorkingImage(image: ChannelImage): void {
    this._workingImage.set(image);
  }

  // --- Execution ---------------------------------------------------------

  /**
   * Runs a DogNode through the worker, using whatever's currently in
   * workingImage as the source pixels. A bare leaf DogConfigNode is wrapped
   * in a one-component DogLayer first; an already-composed DogLayer (e.g.
   * from DogLayerComponent.toModel()) runs as-is.
   *
   * Throws if no working image has been set yet - callers should only be
   * reachable once preprocessing has produced one (e.g. disable Preview
   * buttons until workingImage() is non-null).
   *
   * This does NOT do any stale-response filtering - if a caller can fire
   * overlapping calls (e.g. a "Preview" button that isn't disabled while a
   * run is in flight), it should track its own request counter and ignore
   * out-of-order results. That's a one-line, per-instance concern (see
   * xdog.ts's runPreview(), which keeps a plain `previewRequestId` field),
   * not something worth a class of its own.
   */
  async run(node: DogNode): Promise<ChannelImage | undefined> {
    if (!this.client) {
      return undefined;
    }
    const image = this._workingImage();
    if (!image) {
      throw new Error('No working image set - preprocessing must run before a DoG preview.');
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