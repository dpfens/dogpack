/**
 * Elementwise composition primitives for parameter maps (ChannelImage
 * used as p / epsilon / phi overrides in DoGConfig).
 */

import type { ChannelImage } from '../interfaces/base.js';

function assertSameShape(a: ChannelImage, b: ChannelImage): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`ChannelImage shape mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
}

export function mapChannel(image: ChannelImage, fn: (value: number, index: number) => number): ChannelImage {
  const data = new Float32Array(image.data.length);
  for (let i = 0; i < image.data.length; i++) data[i] = fn(image.data[i], i);
  return { data, width: image.width, height: image.height };
}

export function combineChannels(
  images: ChannelImage[],
  fn: (values: number[], index: number) => number
): ChannelImage {
  const [first, ...rest] = images;
  for (const img of rest) assertSameShape(first, img);
  const data = new Float32Array(first.data.length);
  const scratch = new Array(images.length);
  for (let i = 0; i < data.length; i++) {
    for (let m = 0; m < images.length; m++) scratch[m] = images[m].data[i];
    data[i] = fn(scratch, i);
  }
  return { data, width: first.width, height: first.height };
}

export function constantChannel(value: number, like: ChannelImage): ChannelImage {
  return { data: new Float32Array(like.data.length).fill(value), width: like.width, height: like.height };
}

/** low where weight=0, high where weight=1. Any of the three may be a plain number. */
export function lerpChannel(
  low: ChannelImage | number,
  high: ChannelImage | number,
  weight: ChannelImage | number
): ChannelImage {
  const ref = [low, high, weight].find((v): v is ChannelImage => typeof v !== 'number')!;
  const asImg = (v: ChannelImage | number) => (typeof v === 'number' ? constantChannel(v, ref) : v);
  return combineChannels([asImg(low), asImg(high), asImg(weight)], ([l, h, w]) => l + (h - l) * w);
}

export function normalizeChannel(image: ChannelImage): ChannelImage {
  let min = Infinity, max = -Infinity;
  for (const v of image.data) { if (v < min) min = v; if (v > max) max = v; }
  const range = max - min;
  return range < 1e-8 ? mapChannel(image, () => 0.5) : mapChannel(image, (v) => (v - min) / range);
}

/** Elementwise product -- require agreement between "suppress here" maps. */
export function multiplyChannels(images: ChannelImage[]): ChannelImage {
  return combineChannels(images, (values) => values.reduce((acc, v) => acc * v, 1));
}

/** Weighted sum, renormalized so weights need not sum to 1. */
export function blendChannels(entries: Array<{ map: ChannelImage; weight: number }>): ChannelImage {
  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0) || 1;
  return combineChannels(
    entries.map((e) => e.map),
    (values) => values.reduce((sum, v, i) => sum + v * entries[i].weight, 0) / totalWeight
  );
}
