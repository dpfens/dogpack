import {
  afterNextRender,
  Component,
  ComponentRef,
  ElementRef,
  inject,
  Injector,
  output,
  Renderer2,
  signal,
  Type,
  ViewChild,
  viewChildren,
  ViewContainerRef,
  WritableSignal,
} from '@angular/core';
import { XDogComponent } from '../xdog/xdog';
import { FDogComponent } from '../fdog/fdog';
import { ADogComponent } from '../adog/adog';
import { HDogComponent } from '../hdog/hdog';
import { BlendFunction, ChannelImage, extensions } from 'dogpack';
import { DogComponentType, DogLayer, DogModelProvider, DogNode } from '../../../models/dog';
import { DoGService } from '../../../services/dog/dog-service';
import { luminanceToImageData } from 'dogpack/utils';

type DogLeaf = XDogComponent | FDogComponent | ADogComponent | HDogComponent;
type DogNodeInstance = DogLayerComponent | DogLeaf;
type DogRef = ComponentRef<DogNodeInstance>;

/** Discriminant used to label/create each node kind and pick its component class. */
type DogNodeKind = 'layer' | DogComponentType;

interface DogEntry {
  id: number;
  kind: DogNodeKind;
  ref: DogRef;
  /** Whether ref's DOM has been relocated into its row's `#slot` yet. */
  attached: boolean;
}

/** Picks the component class for a leaf kind. Exhaustive over DogComponentType. */
function leafComponent(type: DogComponentType): Type<DogLeaf> {
  switch (type) {
    case 'xdog': return XDogComponent;
    case 'fdog': return FDogComponent;
    case 'adog': return ADogComponent;
    case 'hdog': return HDogComponent;
  }
}

@Component({
  selector: 'dog-layer',
  imports: [],
  templateUrl: './layer.html',
  styleUrl: './layer.scss',
})
export class DogLayerComponent implements DogModelProvider<DogLayer> {
  /**
   * Hidden mounting point. createComponent() needs *some* ViewContainerRef to
   * instantiate into; every node is created here first and then its native
   * DOM node is relocated into the matching row's `#slot` (see attach()).
   * This keeps add()/addLayer() synchronous (their ComponentRef is available
   * immediately) while still letting each node render inline with its own
   * remove control in the template.
   */
  @ViewChild('container', { read: ViewContainerRef, static: true })
  container!: ViewContainerRef;

  /** One `#slot` div per row, in the same order as `instances()`. */
  private readonly slots = viewChildren('slot', { read: ElementRef });

  private readonly renderer = inject(Renderer2);
  private readonly injector = inject(Injector);
  private readonly dogService = inject(DoGService);
  private nextId = 0;

  readonly name: WritableSignal<string> = signal('');
  readonly instances: WritableSignal<DogEntry[]> = signal([]);
  readonly blend: WritableSignal<BlendFunction | undefined> = signal(undefined);

  /**
   * Result of running this layer's own composed model (this node plus every
   * descendant, per toModel()) through the DoG worker. Emitted for any
   * declarative parent that happens to have one; the DoGService.show() push in
   * runPreview() below is what actually reaches the Workbench, since most
   * dog-layer instances are created dynamically with no such parent.
   */
  readonly channelImage = output<ChannelImage>();

  /** True while a preview run is in flight - bind a spinner/disabled state to this. */
  readonly previewPending = signal(false);

  /** Menu options rendered by the "Add node" dropdown in the template. */
  readonly nodeTypes: ReadonlyArray<{ kind: DogNodeKind; label: string }> = [
    { kind: 'layer', label: 'Layer' },
    { kind: 'xdog', label: 'XDoG' },
    { kind: 'fdog', label: 'FDoG' },
    { kind: 'adog', label: 'ADoG' },
    { kind: 'hdog', label: 'HDoG' },
  ];

  /**
   * Blend mode choices for the select in the template.
   * NOTE: assumes `BlendFunction` is a runtime (string) enum exported by
   * `dogpack`. If it's actually a type-only union, replace this with an
   * explicit literal array of the modes you support.
   */
  readonly blendModes: BlendFunction[] = Object.values(extensions.multiScale.BlendFunctions) as BlendFunction[];

  add<T extends DogNodeInstance>(cmp: Type<T>, kind: DogNodeKind): ComponentRef<T> {
    const ref = this.container.createComponent(cmp);
    const id = this.nextId++;
    this.instances.update(list => [...list, { id, kind, ref: ref as DogRef, attached: false }]);
    afterNextRender(() => this.attach(id), { injector: this.injector });
    return ref;
  }

  addLayer(): ComponentRef<DogLayerComponent> {
    return this.add(DogLayerComponent, 'layer');
  }

  /** Adds a node of the given kind. Used by the "Add node" dropdown. */
  addNode(kind: DogNodeKind): DogRef {
    if (kind === 'layer') {
      return this.addLayer();
    }
    return this.add(leafComponent(kind), kind);
  }

  remove(entry: DogEntry): boolean {
    const list = this.instances();
    if (!list.includes(entry)) return false;

    const el = entry.ref.location.nativeElement as HTMLElement;
    entry.ref.destroy();
    // Defensive cleanup: destroy() removes the view from the parent Angular
    // recorded at creation time (the hidden container), not from wherever we
    // relocated its DOM node to. If it's still sitting in a row's #slot,
    // remove it explicitly so we don't leak a detached-but-visible element.
    if (el.parentNode) {
      this.renderer.removeChild(el.parentNode, el);
    }

    this.instances.set(list.filter(e => e !== entry));
    return true;
  }

  clear(): void {
    this.instances().forEach(entry => {
      const el = entry.ref.location.nativeElement as HTMLElement;
      entry.ref.destroy();
      if (el.parentNode) {
        this.renderer.removeChild(el.parentNode, el);
      }
    });
    this.instances.set([]);
  }

  /** Moves a newly-created node's DOM into its row's `#slot`, once it exists. */
  private attach(id: number): void {
    const list = this.instances();
    const index = list.findIndex(e => e.id === id);
    if (index === -1) return; // removed before it ever got attached

    const entry = list[index];
    if (entry.attached) return;

    const slot = this.slots()[index];
    if (!slot) return; // shouldn't happen, but bail out safely

    this.renderer.appendChild(slot.nativeElement, entry.ref.location.nativeElement);
    entry.attached = true;
  }

  /**
   * Derives the Angular-free DogLayer tree on demand. ComponentRefs are the
   * mounting detail; the returned value is pure data. Every child implements
   * DogModelProvider, so toModel() is called polymorphically across leaves
   * and nested layers alike.
   */
  toModel(): DogLayer {
    const components: DogNode[] = this.instances().map(entry => entry.ref.instance.toModel());
    return {
      kind: 'layer',
      name: this.name(),
      blendMode: this.blend()!,
      components,
    };
  }

  /**
   * Wire this to a "Preview" button in layer.html. Runs this layer's full
   * composed model - itself plus every nested layer/leaf - through the
   * worker as one DogLayer; DoGService.run() passes it through unwrapped
   * since it's already a layer, not a bare leaf config.
   *
   * Reports through DoGService's shared focus state (not just the
   * channelImage output),
   * since this component is usually created dynamically with no parent
   * template able to bind to that output - see the class doc comment above.
   */
  async runPreview(): Promise<void> {
    this.previewPending.set(true);
    this.dogService.setPending({ kind: 'layer', name: this.name() });
    try {
      const layer = this.toModel();
      const image = await this.dogService.run(layer);
      if (image) {
        this.channelImage.emit(image);
        this.dogService.show({ kind: 'layer', name: this.name() }, luminanceToImageData(image));
      }
    } finally {
      this.previewPending.set(false);
    }
  }
}