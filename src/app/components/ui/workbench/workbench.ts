import { Component, computed, effect, inject, input, signal, viewChild } from '@angular/core';

import { ImageCanvasComponent, ImageStatus } from '../image-canvas/image-canvas';
import { PreprocessingComponent } from '../../dog/preprocessing-component/preprocessing-component';
import { DogLayerComponent } from '../../dog/layer/layer';
import { DoGService } from '../../../services/dog/dog-service';
import { PreprocessingService } from '../../../services/preprocessing/preprocessing';
import { VideoFrameService } from '../../../services/video-frame/video-frame-service';
import { SourceMedia } from '../../../services/source-media/source-media-service';
import { luminanceToImageData } from 'dogpack/utils';

@Component({
  selector: 'app-workbench',
  imports: [ImageCanvasComponent, PreprocessingComponent, DogLayerComponent],
  templateUrl: './workbench.html',
  styleUrl: './workbench.scss',
})
export class WorkbenchComponent {
  private readonly dogService = inject(DoGService);
  private readonly preprocessingService = inject(PreprocessingService);
  private readonly videoFrameService = inject(VideoFrameService);

  /**
   * Handles to the live pipeline the user has built, so a batch export can
   * read the same state interactively-tuned preview reads - see
   * `runFrameThroughPipeline()`. Both are only present once `sourceImage()`
   * is non-null (see workbench.html), so these are undefined until then.
   */
  private readonly preprocessingComponent = viewChild<PreprocessingComponent>('preprocessing');
  private readonly rootLayer = viewChild<DogLayerComponent>('rootLayer');

  /** The untouched image or video the whole pipeline starts from. */
  readonly sourceMedia = input.required<SourceMedia>();

  readonly isVideo = computed(() => this.sourceMedia().kind === 'video');

  /** First decoded frame of a video source, once probed. Null for images
   *  (which don't need it) and null for video until decoding finishes. */
  private readonly _videoPreviewFrame = signal<ImageData | null>(null);

  /**
   * A single representative image to build/tune the pipeline against.
   * For an image source this is just the image itself; for a video
   * source it's the first frame — the full clip is only decoded when
   * `exportVideo()` actually runs.
   */
  readonly sourceImage = computed<ImageData | null>(() => {
    const media = this.sourceMedia();
    return media.kind === 'image' ? media.imageData : this._videoPreviewFrame();
  });

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

  // ---- Video export ----

  readonly videoExportState = signal<'idle' | 'running' | 'done' | 'error'>('idle');
  readonly videoExportError = signal<string | null>(null);
  private readonly _videoResultBlob = signal<Blob | null>(null);
  private readonly _videoResultUrl = signal<string | null>(null);
  readonly videoResultUrl = this._videoResultUrl.asReadonly();

  readonly videoExportProgress = computed(() => {
    // Decoding and encoding happen interleaved, frame by frame, inside
    // VideoFrameService.transformVideo() - averaging the two signals
    // gives a reasonable single progress bar.
    return (this.videoFrameService.extractionProgress() + this.videoFrameService.encodingProgress()) / 2;
  });

  constructor() {
    // Probe the first frame whenever a new video is loaded, so the
    // pipeline-building UI has something to render against.
    effect(() => {
      const media = this.sourceMedia();
      this._videoPreviewFrame.set(null);
      this.videoExportState.set('idle');
      this.videoExportError.set(null);
      this._videoResultBlob.set(null);

      if (media.kind !== 'video') return;

      this.videoFrameService
        .getFirstFrame(media.file)
        .then((frame) => this._videoPreviewFrame.set(frame.imageData))
        .catch(() => this.videoExportError.set('Could not read that video file.'));
    });

    // Turn each new result Blob into an object URL for the <video>
    // preview / download link, and revoke the previous one so we don't
    // leak a blob URL per export run.
    effect((onCleanup) => {
      const blob = this._videoResultBlob();
      if (!blob) {
        this._videoResultUrl.set(null);
        return;
      }
      const url = URL.createObjectURL(blob);
      this._videoResultUrl.set(url);
      onCleanup(() => URL.revokeObjectURL(url));
    });
  }

  /**
   * Runs the full composed pipeline (preprocessing, then every
   * layer/leaf in the tree, same as the "Run" button in the pipeline
   * card) over every frame of the source video, sequentially, and
   * re-encodes the results into a new MP4. Streams frame-by-frame via
   * VideoFrameService.transformVideo(), so memory stays bounded
   * regardless of clip length - nothing decodes/encodes the whole
   * clip up front.
   */
  async exportVideo(): Promise<void> {
    const media = this.sourceMedia();
    if (media.kind !== 'video') return;

    this.videoExportState.set('running');
    this.videoExportError.set(null);
    this._videoResultBlob.set(null);

    const blob = await this.videoFrameService.transformVideo(
      media.file,
      (frame) => this.runFrameThroughPipeline(frame.imageData),
      {
        // Audio is passed through unmodified - we're only touching video.
        sourceFileForAudio: media.file,
      }
    );
    this._videoResultBlob.set(blob);
    this.videoExportState.set('done');

    /*
    try {
      
    } catch {
      this.videoExportError.set('Could not process this video.');
      this.videoExportState.set('error');
    }
      */
  }

  /**
   * Runs a single frame through the full composed pipeline - the same
   * preprocessing steps and layer tree the "Run" buttons above use - and
   * returns the result, ready to hand back to VideoFrameService for
   * re-encoding.
   *
   * Deliberately bypasses `dogService.setPending()`/`show()`: those drive
   * the *interactive* preview (activeImage/activeLabel), and firing them
   * once per frame during a batch export would spam the preview panel with
   * intermediate frames while the user's looking at something else.
   *
   * Note: `dogService`'s working-image slot is shared, mutable state - the
   * same slot PreprocessingComponent's own effect writes to. Editing the
   * pipeline (or its preprocessing steps) while an export is running can
   * race with this loop; the "Run" button below is disabled during export
   * for that reason, but there's currently nothing stopping someone from
   * still editing the preprocessing step list mid-export.
   */
  private async runFrameThroughPipeline(image: ImageData): Promise<ImageData> {
    const preprocessing = this.preprocessingComponent();
    const rootLayer = this.rootLayer();
    if (!preprocessing || !rootLayer) {
      throw new Error('Pipeline is not ready yet.');
    }

    const { channel } = await this.preprocessingService.apply(
      preprocessing.steps(),
      image,
      preprocessing.channelMode()
    );
    this.dogService.setWorkingImage(channel);

    const node = rootLayer.toModel();
    const result = await this.dogService.run(node);
    if (!result) {
      throw new Error('DoG worker is unavailable.');
    }
    return luminanceToImageData(result);
  }
}