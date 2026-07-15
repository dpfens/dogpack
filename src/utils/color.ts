/**
 * Color space conversion utilities
 *
 * Responsible for turning an RGBImage into a set of independent
 * ChannelImage instances, either as raw RGB channels or as CIE Lab
 * channels (L, a, b). Kept separate from the ETF/structure-tensor math
 * so that flow.ts stays focused purely on the Di Zenzo / eigen-decomposition
 * pipeline and doesn't need to know anything about color science.
 */

import type { ChannelImage, RGBImage } from '../interfaces/base.js';
import { createChannelImage } from './index.js';

/**
 * Which color space to decompose an RGBImage into before computing
 * a multi-channel Edge Tangent Flow.
 */
export type ColorSpace = 'rgb' | 'lab';

/**
 * Split an interleaved RGBImage into three independent ChannelImages,
 * one per channel, each still in 0-1 range.
 */
export function splitRGBChannels(rgb: RGBImage): [ChannelImage, ChannelImage, ChannelImage] {
  const { width, height, data } = rgb;
  const size = width * height;

  const r = createChannelImage(width, height);
  const g = createChannelImage(width, height);
  const b = createChannelImage(width, height);

  for (let i = 0; i < size; i++) {
    const o = i * 3;
    r.data[i] = data[o];
    g.data[i] = data[o + 1];
    b.data[i] = data[o + 2];
  }

  return [r, g, b];
}

/**
 * Convert an interleaved RGBImage into three independent ChannelImages
 * representing CIE Lab's L, a, and b components.
 *
 * L is normalized from its native [0, 100] range to [0, 1] by dividing by 100.
 * a and b are normalized from their native (roughly [-128, 127]) range to
 * [0, 1] via (v + 128) / 255.
 *
 * This normalization is a deliberate choice: it keeps all three channels in
 * comparable numeric ranges before gradients/tensors are computed, so that
 * chroma channels don't dominate or get drowned out purely due to differing
 * native scales relative to L. Input RGB is assumed to be sRGB with values
 * in [0, 1].
 */
export function rgbToLabChannels(rgb: RGBImage): [ChannelImage, ChannelImage, ChannelImage] {
  const { width, height, data } = rgb;
  const size = width * height;

  const l = createChannelImage(width, height);
  const a = createChannelImage(width, height);
  const bCh = createChannelImage(width, height);

  for (let i = 0; i < size; i++) {
    const o = i * 3;
    const [labL, labA, labB] = srgbToLab(data[o], data[o + 1], data[o + 2]);
    l.data[i] = labL / 100;
    a.data[i] = (labA + 128) / 255;
    bCh.data[i] = (labB + 128) / 255;
  }

  return [l, a, bCh];
}

/**
 * Convert a single sRGB pixel (each component in [0, 1]) to CIE Lab
 * (D65 white point). L is in [0, 100]; a and b are roughly in [-128, 127]
 * but are not hard-clamped.
 */
export function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const [x, y, z] = srgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

// D65 reference white, 2-degree observer
const REF_X = 0.95047;
const REF_Y = 1.0;
const REF_Z = 1.08883;

function srgbChannelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function srgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbChannelToLinear(r);
  const lg = srgbChannelToLinear(g);
  const lb = srgbChannelToLinear(b);

  // sRGB -> XYZ (D65) matrix
  const x = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
  const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750;
  const z = lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041;

  return [x, y, z];
}

function xyzToLab(x: number, y: number, z: number): [number, number, number] {
  const fx = labF(x / REF_X);
  const fy = labF(y / REF_Y);
  const fz = labF(z / REF_Z);

  const l = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);

  return [l, a, b];
}

function labF(t: number): number {
  const delta = 6 / 29;
  return t > delta ** 3 ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29;
}