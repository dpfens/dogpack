import { Injectable, inject } from '@angular/core';
import { GoogleAnalyticsService } from './google-analytics.service';
import { DogComponentType, DogNodeKind } from '../../models/dog';
import type { ChannelMode, PipelineStepConfig } from '../../models/preprocessing';

type PreprocessingStepType = PipelineStepConfig['type'];

/**
 * Helper service for tracking dogpack app events with consistent structure.
 *
 * This is the single place that decides *what* gets tracked and with what
 * shape - components should call these named methods rather than building
 * GtagEvent objects themselves, so the event taxonomy (action/category/label
 * names) stays consistent and discoverable in one file.
 *
 * Two event categories are used throughout:
 *  - 'preprocessing' - the linear PipelineStepConfig[] pipeline
 *  - 'dog_pipeline'  - the DoG layer/leaf tree (layer, xdog, fdog, adog, hdog)
 */
@Injectable({
  providedIn: 'root'
})
export class ApplicationAnalyticsService {
  private ga = inject(GoogleAnalyticsService);

  // User Properties (call once on app load)
  setUserProperties(totalStopwatches: number, totalGroups: number): void {
    this.ga.setUserProperties({
      stopwatch_count: totalStopwatches,
      group_count: totalGroups,
      is_power_user: totalStopwatches > 10 || totalGroups > 3
    });
  }

  // ---------------------------------------------------------------------
  // Preprocessing pipeline (preprocessing-component.ts)
  // ---------------------------------------------------------------------

  /** A preprocessing step was added via the "Add step" dropdown. */
  trackPreprocessingStepAdded(stepType: PreprocessingStepType): void {
    this.ga.trackEvent({
      action: 'preprocessing_step_add',
      category: 'preprocessing',
      label: stepType,
    });
  }

  /** A preprocessing step was removed. */
  trackPreprocessingStepRemoved(stepType: PreprocessingStepType): void {
    this.ga.trackEvent({
      action: 'preprocessing_step_remove',
      category: 'preprocessing',
      label: stepType,
    });
  }

  /** A preprocessing step was moved up/down in the pipeline order. */
  trackPreprocessingStepReordered(stepType: PreprocessingStepType, direction: 'up' | 'down'): void {
    this.ga.trackEvent(
      { action: 'preprocessing_step_reorder', category: 'preprocessing', label: stepType },
      { direction },
    );
  }

  /** The named preset for a 'preset' step was changed (light/standard/heavy/...). */
  trackPreprocessingPresetSelected(presetName: string): void {
    this.ga.trackEvent({
      action: 'preprocessing_preset_select',
      category: 'preprocessing',
      label: presetName,
    });
  }

  /** RGB vs luminance channel mode was toggled. */
  trackPreprocessingChannelModeChanged(mode: ChannelMode): void {
    this.ga.trackEvent({
      action: 'preprocessing_channel_mode_change',
      category: 'preprocessing',
      label: mode,
    });
  }

  // ---------------------------------------------------------------------
  // Source image lifecycle (app.ts / image-canvas.ts)
  // ---------------------------------------------------------------------

  /** Size buckets for uploaded images - coarse enough to avoid near-unique values. */
  private bucketFileSize(bytes: number): string {
    const MB = 1024 * 1024;
    if (bytes < 1 * MB) return '<1MB';
    if (bytes < 5 * MB) return '1-5MB';
    if (bytes < 10 * MB) return '5-10MB';
    if (bytes < 25 * MB) return '10-25MB';
    return '25MB+';
  }

  /** A source image was loaded, either dropped onto the landing zone or picked via the file input. */
  trackImageUploaded(sizeBytes: number, source: 'drop' | 'browse'): void {
    this.ga.trackEvent(
      {
        action: 'image_upload',
        category: 'source_image',
        label: this.bucketFileSize(sizeBytes),
        value: Math.round(sizeBytes / 1024), // KB, for rough magnitude in reports
      },
      { source },
    );
  }

  /** The user zoomed the preview canvas (tracked once per loaded image, not per wheel tick). */
  trackCanvasZoomUsed(): void {
    this.ga.trackEvent({ action: 'zoom', category: 'image_canvas' });
  }

  /** The result image was downloaded from the preview canvas. */
  trackImageDownloaded(): void {
    this.ga.trackEvent({ action: 'download', category: 'image_canvas' });
  }

  // ---------------------------------------------------------------------
  // DoG layer tree (layer.ts) - add/remove/blend/run of the composed tree
  // ---------------------------------------------------------------------

  /** A node (layer or leaf) was added under some dog-layer via the dropdown. */
  trackNodeAdded(kind: DogNodeKind): void {
    this.ga.trackEvent({ action: 'node_add', category: 'dog_pipeline', label: kind });
  }

  /** A node (layer or leaf) was removed from its parent layer. */
  trackNodeRemoved(kind: DogNodeKind): void {
    this.ga.trackEvent({ action: 'node_remove', category: 'dog_pipeline', label: kind });
  }

  /** A layer's blend mode selector changed. */
  trackBlendModeChanged(mode: string): void {
    this.ga.trackEvent({ action: 'blend_mode_change', category: 'dog_pipeline', label: mode });
  }

  /**
   * A layer's own "Preview" / "Run" button ran its full composed subtree
   * (itself plus every nested child). `nodeCount` is the layer's direct
   * child count, `durationMs` the wall-clock time of the run.
   */
  trackLayerPreviewRun(durationMs: number, nodeCount: number): void {
    this.ga.trackEvent(
      { action: 'preview_run', category: 'dog_pipeline', label: 'layer', value: Math.round(durationMs) },
      { node_count: nodeCount },
    );
  }

  // ---------------------------------------------------------------------
  // Individual DoG nodes (xdog / fdog / adog / hdog)
  // ---------------------------------------------------------------------

  /** A built-in style preset was selected on a leaf DoG node. */
  trackDogPresetSelected(nodeType: DogComponentType, presetName: string): void {
    this.ga.trackEvent({
      action: 'preset_select',
      category: 'dog_node',
      label: `${nodeType}:${presetName}`,
    });
  }

  /** A leaf DoG node's own "Preview" button ran just that node. */
  trackDogPreviewRun(nodeType: DogNodeKind, durationMs: number): void {
    this.ga.trackEvent({
      action: 'preview_run',
      category: 'dog_node',
      label: nodeType,
      value: Math.round(durationMs),
    });
  }
}
