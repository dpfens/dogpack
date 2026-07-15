/**
 * Shared FlowField result type for Edge Tangent Flow backends.
 */

import type { ChannelImage, FlowField, Vec2 } from '../interfaces/base.js';
import { createChannelImage } from '../utils/index.js';

export class TangentFlowField implements FlowField {
  // Flat, stride-2 (x, y) buffer — avoids allocating pixelCount JS
  // objects regardless of which backend produced the data.
  private constructor(
    private readonly tangents: Float32Array,
    readonly width: number,
    readonly height: number
  ) {}

  static fromFloat32Array(tangents: Float32Array, width: number, height: number): TangentFlowField {
    return new TangentFlowField(tangents, width, height);
  }

  static fromVec2Array(tangents: Vec2[], width: number, height: number): TangentFlowField {
    const flat = new Float32Array(tangents.length * 2);
    for (let i = 0; i < tangents.length; i++) {
      flat[i * 2] = tangents[i].x;
      flat[i * 2 + 1] = tangents[i].y;
    }
    return new TangentFlowField(flat, width, height);
  }

  getTangent(x: number, y: number): Vec2 {
    const clampedX = Math.max(0, Math.min(this.width - 1, Math.round(x)));
    const clampedY = Math.max(0, Math.min(this.height - 1, Math.round(y)));
    const idx = (clampedY * this.width + clampedX) * 2;
    return { x: this.tangents[idx], y: this.tangents[idx + 1] };
  }

  getTangentArray(): Float32Array {
    return this.tangents.slice();
  }

  /**
   * Visualize the flow field as a grayscale image.
   * Encodes direction as intensity (useful for debugging).
   */
  visualize(): ChannelImage {
    const output = createChannelImage(this.width, this.height);

    for (let i = 0; i < this.width * this.height; i++) {
      const tx = this.tangents[i * 2];
      const ty = this.tangents[i * 2 + 1];
      const angle = Math.atan2(ty, tx);
      output.data[i] = (angle + Math.PI) / (2 * Math.PI);
    }

    return output;
  }

  /**
   * Visualize as a color image (HSV with direction as hue).
   */
  visualizeColor(): ImageData {
    const imageData = new ImageData(this.width, this.height);

    for (let i = 0; i < this.width * this.height; i++) {
      const tx = this.tangents[i * 2];
      const ty = this.tangents[i * 2 + 1];

      // Direction as hue
      const angle = Math.atan2(ty, tx);
      const hue = (angle + Math.PI) / (2 * Math.PI);

      // Magnitude as saturation/value (always 1 for normalized vectors)
      const [r, g, b] = hsvToRgb(hue, 1, 1);

      const o = i * 4;
      imageData.data[o] = r;
      imageData.data[o + 1] = g;
      imageData.data[o + 2] = b;
      imageData.data[o + 3] = 255;
    }

    return imageData;
  }
}

/**
 * Convert HSV to RGB. Only used by visualizeColor() above.
 */
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  let r: number, g: number, b: number;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
    default: r = 0; g = 0; b = 0;
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}