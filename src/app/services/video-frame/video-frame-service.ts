import { Injectable, signal } from '@angular/core';
import {
  Input,
  Output,
  BufferTarget,
  BlobSource,
  Mp4OutputFormat,
  ALL_FORMATS,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
  EncodedPacketSink,
  EncodedAudioPacketSource,
} from 'mediabunny';
import type { InputAudioTrack } from 'mediabunny';

/**
 * A single decoded video frame plus enough timing metadata to
 * reconstruct playback speed when re-encoding.
 *
 * Note: Mediabunny uses seconds for timestamps/durations (unlike the
 * raw WebCodecs API, which uses microseconds).
 */
export interface ExtractedFrame {
  imageData: ImageData;
  /** Presentation timestamp, in seconds. */
  timestamp: number;
  /** Frame duration, in seconds. */
  duration: number;
}

export interface FrameExtractionResult {
  frames: ExtractedFrame[];
  /** Display width, after rotation metadata has been applied. */
  width: number;
  /** Display height, after rotation metadata has been applied. */
  height: number;
}

export interface VideoDimensions {
  /** Display width, after rotation metadata has been applied. */
  width: number;
  /** Display height, after rotation metadata has been applied. */
  height: number;
  /** Total duration in seconds. */
  duration: number;
}

export interface EncodeOptions {
  width: number;
  height: number;
  /** Target bitrate in bits/sec. Default: 5 Mbps. */
  bitrate?: number;
  /** Video codec. Default: 'avc' (H.264) for broad compatibility. */
  codec?: 'avc' | 'hevc' | 'vp9' | 'av1';
  /** Force a keyframe at least this often, in seconds. Default: 2. */
  keyFrameInterval?: number;
  /**
   * The original uploaded file, if you want its audio track carried
   * over into the output. The audio is passed through unmodified
   * (no decode/re-encode), so there's no quality loss and no need to
   * match codecs with the video.
   */
  sourceFileForAudio?: File;
}

/**
 * Converts uploaded video files to arrays of ImageData (for per-frame
 * processing) and back into playable MP4 blobs, using Mediabunny
 * (a WebCodecs-based media toolkit).
 *
 * Requires:
 *   npm install mediabunny
 *
 * Why Mediabunny instead of hand-rolling mp4box.js + WebCodecs +
 * mp4-muxer: it demuxes MP4/MOV/WebM/etc. itself (so iPhone .mov
 * files work the same as Android .mp4 files), it resolves each
 * track's rotation matrix for you via getDisplayWidth/Height (phone
 * portrait video no longer comes out sideways), and it supports
 * passing an audio track through to the output without a decode/
 * encode round trip. mp4-muxer (used in an earlier version of this
 * service) has been deprecated by its maintainer in favor of
 * Mediabunny.
 *
 * Browser support: relies on the WebCodecs API under the hood.
 * Check `VideoFrameService.isSupported()` before use.
 *
 * MEMORY: A single decoded 1080p RGBA frame is ~8.3MB. Collecting an
 * entire clip into an `ExtractedFrame[]` (as `videoToFrames` /
 * `framesToVideo` do) means holding every frame in memory at once —
 * a 60s/30fps 1080p clip is on the order of 15GB. Prefer:
 *   - `videoFrames()` to stream frames one at a time, or
 *   - `transformVideo()` to decode, process, and re-encode a frame
 *     at a time without ever materializing the full clip.
 * Reach for the array-based `videoToFrames`/`framesToVideo` only when
 * you genuinely need random access to frames (e.g. a scrubber UI) or
 * are working with short clips.
 */
@Injectable({ providedIn: 'root' })
export class VideoFrameService {
  /** 0–1 progress of the current decode/extraction operation. */
  readonly extractionProgress = signal(0);
  /** 0–1 progress of the current encode operation. */
  readonly encodingProgress = signal(0);

  /** Feature-detect WebCodecs support (Mediabunny needs it for hardware codecs). */
  static isSupported(): boolean {
    return (
      typeof VideoDecoder !== 'undefined' &&
      typeof VideoEncoder !== 'undefined'
    );
  }

  /**
   * Cheap metadata probe: display dimensions and total duration,
   * without decoding any frames. Useful when you need dimensions
   * up front (e.g. to size a canvas) before streaming frames via
   * `videoFrames()`.
   */
  async getVideoDimensions(file: File): Promise<VideoDimensions> {
    const input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(file),
    });

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('No video track found in this file');

    const width = await videoTrack.getDisplayWidth();
    const height = await videoTrack.getDisplayHeight();
    const duration = await input.computeDuration();

    return { width, height, duration };
  }

  /**
   * Stream every frame of an uploaded video file as decoded ImageData,
   * one at a time. Frames are already corrected for the file's rotation
   * metadata, so portrait phone video comes out right-side up.
   *
   * Unlike `videoToFrames`, this never holds more than one decoded
   * frame in memory — prefer it for anything beyond short clips.
   */
  async *videoFrames(file: File): AsyncGenerator<ExtractedFrame, void, void> {
    const input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(file),
    });

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('No video track found in this file');

    const width = await videoTrack.getDisplayWidth();
    const height = await videoTrack.getDisplayHeight();
    const totalDuration = await input.computeDuration();

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not acquire 2D canvas context');

    const sink = new VideoSampleSink(videoTrack);

    this.extractionProgress.set(0);
    for await (const sample of sink.samples()) {
      // draw() already applies the track's rotation/mirroring transform.
      sample.draw(ctx, 0, 0);
      const imageData = ctx.getImageData(0, 0, width, height);
      const { timestamp, duration } = sample;
      sample.close();

      if (totalDuration > 0) {
        this.extractionProgress.set(Math.min(1, timestamp / totalDuration));
      }

      yield { imageData, timestamp, duration };
    }

    this.extractionProgress.set(1);
  }

  /**
   * Convenience wrapper around `videoFrames()` that collects every
   * frame into an array. Holds the entire decoded clip in memory at
   * once — fine for short clips or when you need random access to
   * frames (e.g. a scrubber UI), but prefer `videoFrames()` or
   * `transformVideo()` otherwise.
   */
  async videoToFrames(file: File): Promise<FrameExtractionResult> {
    const { width, height } = await this.getVideoDimensions(file);

    const frames: ExtractedFrame[] = [];
    for await (const frame of this.videoFrames(file)) {
      frames.push(frame);
    }

    return { frames, width, height };
  }

  /**
   * Decode just the first frame of a video. Useful for building a
   * representative preview — e.g. so a user can tune a pipeline
   * against a single frame before running it over the whole clip —
   * without paying the cost of decoding (or the memory of holding)
   * every frame.
   */
  async getFirstFrame(file: File): Promise<ExtractedFrame> {
    for await (const frame of this.videoFrames(file)) {
      return frame;
    }
    throw new Error('Video has no frames');
  }

  /**
   * Encode a sequence of ImageData frames (e.g. after per-frame
   * processing) back into a playable MP4 Blob. Accepts either an
   * array or an (async) iterable/generator, so it can be fed directly
   * from `videoFrames()` without ever materializing a full frame
   * array. Pass `sourceFileForAudio` to carry the original audio
   * track over unchanged.
   *
   * Pass `totalDuration` (in seconds) for accurate `encodingProgress`
   * when frames aren't an array — otherwise progress can't be
   * computed up front since the frame count isn't known.
   */
  async framesToVideo(
    frames: Iterable<ExtractedFrame> | AsyncIterable<ExtractedFrame>,
    options: EncodeOptions & { totalDuration?: number }
  ): Promise<Blob> {
    this.encodingProgress.set(0);

    const { width, height, totalDuration, ...encodeOpts } = options;
    const { output, videoSource, canvas, ctx, audioPassthrough } =
      await this.setupOutput(width, height, encodeOpts);

    let frameCount = 0;
    for await (const frame of frames) {
      frameCount++;
      ctx.putImageData(frame.imageData, 0, 0);

      const sample = new VideoSample(canvas, {
        timestamp: frame.timestamp,
        duration: frame.duration,
      });
      await videoSource.add(sample);
      sample.close();

      if (totalDuration && totalDuration > 0) {
        this.encodingProgress.set(Math.min(1, frame.timestamp / totalDuration));
      }
    }

    if (frameCount === 0) throw new Error('No frames to encode');

    const blob = await this.finalizeOutput(output, audioPassthrough);
    this.encodingProgress.set(1);
    return blob;
  }

  /**
   * Decode, process, and re-encode a video one frame at a time,
   * without ever holding the full clip in memory. This is the
   * preferred entry point for "run some per-frame transform on an
   * uploaded video" workflows — memory stays bounded to roughly two
   * frames (the just-decoded source frame and the processed output
   * frame) regardless of clip length.
   *
   * `processFrame` receives each decoded frame and must return the
   * ImageData to encode in its place (return `frame.imageData`
   * unchanged to pass a frame through as-is).
   */
  async transformVideo(
    file: File,
    processFrame: (frame: ExtractedFrame) => ImageData | Promise<ImageData>,
    options: Omit<EncodeOptions, 'width' | 'height'> = {}
  ): Promise<Blob> {
    this.extractionProgress.set(0);
    this.encodingProgress.set(0);

    const { width, height, duration: totalDuration } =
      await this.getVideoDimensions(file);

    const { output, videoSource, canvas, ctx, audioPassthrough } =
      await this.setupOutput(width, height, options);

    // Separate canvas for decoding the source frame — `canvas` above
    // is reserved for writing the (possibly processed) output frame,
    // so the two don't stomp on each other mid-loop.
    const decodeCanvas = new OffscreenCanvas(width, height);
    const decodeCtx = decodeCanvas.getContext('2d');
    if (!decodeCtx) throw new Error('Could not acquire 2D canvas context');

    const input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(file),
    });
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('No video track found in this file');
    const sink = new VideoSampleSink(videoTrack);

    for await (const sample of sink.samples()) {
      sample.draw(decodeCtx, 0, 0);
      const imageData = decodeCtx.getImageData(0, 0, width, height);
      const { timestamp, duration } = sample;
      sample.close();

      if (totalDuration > 0) {
        this.extractionProgress.set(Math.min(1, timestamp / totalDuration));
      }

      const processed = await processFrame({ imageData, timestamp, duration });

      ctx.putImageData(processed, 0, 0);
      const outSample = new VideoSample(canvas, { timestamp, duration });
      await videoSource.add(outSample);
      outSample.close();

      if (totalDuration > 0) {
        this.encodingProgress.set(Math.min(1, timestamp / totalDuration));
      }
    }

    this.extractionProgress.set(1);

    const blob = await this.finalizeOutput(output, audioPassthrough);
    this.encodingProgress.set(1);
    return blob;
  }

  /**
   * Shared setup for `framesToVideo` and `transformVideo`: creates the
   * Mp4 Output, video track/source, optional audio passthrough track,
   * and a scratch canvas sized to the output dimensions. Per
   * Mediabunny's API, all tracks must be added before `output.start()`
   * is called, so audio passthrough is wired up here before encoding
   * begins.
   */
  private async setupOutput(
    width: number,
    height: number,
    options: Pick<
      EncodeOptions,
      'bitrate' | 'codec' | 'keyFrameInterval' | 'sourceFileForAudio'
    >
  ) {
    const {
      bitrate = 5_000_000,
      codec = 'avc',
      keyFrameInterval = 2,
      sourceFileForAudio,
    } = options;

    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new BufferTarget(),
    });

    const videoSource = new VideoSampleSource({
      codec,
      bitrate,
      keyFrameInterval,
    });
    output.addVideoTrack(videoSource);

    let audioPassthrough: {
      track: InputAudioTrack;
      source: EncodedAudioPacketSource;
      decoderConfig: AudioDecoderConfig;
    } | null = null;

    if (sourceFileForAudio) {
      const audioInput = new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(sourceFileForAudio),
      });
      const audioTrack = await audioInput.getPrimaryAudioTrack();
      if (audioTrack) {
        const audioCodec = await audioTrack.getCodec();
        const decoderConfig = await audioTrack.getDecoderConfig();
        if (audioCodec && decoderConfig) {
          const audioSource = new EncodedAudioPacketSource(audioCodec);
          output.addAudioTrack(audioSource);
          audioPassthrough = { track: audioTrack, source: audioSource, decoderConfig };
        } else {
          console.warn(
            'Audio track codec was not recognized by Mediabunny; skipping audio passthrough.'
          );
        }
      }
    }

    await output.start();

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not acquire 2D canvas context');

    return { output, videoSource, canvas, ctx, audioPassthrough };
  }

  /**
   * Shared finalize for `framesToVideo` and `transformVideo`: streams
   * the passthrough audio packets (if any), finalizes the Output, and
   * wraps the resulting buffer in a Blob.
   */
  private async finalizeOutput(
    output: Output,
    audioPassthrough: {
      track: InputAudioTrack;
      source: EncodedAudioPacketSource;
      decoderConfig: AudioDecoderConfig;
    } | null
  ): Promise<Blob> {
    if (audioPassthrough) {
      const audioSink = new EncodedPacketSink(audioPassthrough.track);
      let isFirstPacket = true;
      for await (const packet of audioSink.packets()) {
        if (isFirstPacket) {
          // Mediabunny needs codec/channel/sample-rate (and sometimes a
          // codec-specific `description`) alongside the first packet, to
          // know how to write the audio track's sample entry - it can't
          // infer this from the packet bytes alone.
          await audioPassthrough.source.add(packet, {
            decoderConfig: audioPassthrough.decoderConfig,
          });
          isFirstPacket = false;
        } else {
          await audioPassthrough.source.add(packet);
        }
      }
    }

    await output.finalize();
    const { buffer } = output.target as BufferTarget;
    if (!buffer) {
      throw new Error('Output buffer was empty after finalize()');
    }
    return new Blob([buffer], { type: 'video/mp4' });
  }
}