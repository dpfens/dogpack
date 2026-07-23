/**
 * Raw structure tensor: magnitude (edge confidence) and anisotropy
 * (directional coherence). Kept separate from strategies.ts because it's
 * the one feature with no existing preprocessor to delegate to --
 * ETFComputer only exposes the flow field + trace magnitude
 * (ETFDetailedResult), not the raw e/f/g components anisotropy needs.
 */

import type { ChannelImage } from '../interfaces/base.js';

export interface StructureTensorMaps {
  magnitude: ChannelImage;
  /** (lambda1-lambda2)/(lambda1+lambda2) in [0,1]. 1 = coherent line, 0 = isotropic. */
  anisotropy: ChannelImage;
}

function sobel(data: Float32Array, width: number, height: number) {
  const gx = new Float32Array(data.length), gy = new Float32Array(data.length);
  for (let y = 1; y < height - 1; y++) {
    const up = (y - 1) * width, mid = y * width, down = (y + 1) * width;
    for (let x = 1; x < width - 1; x++) {
      const tl = data[up + x - 1], tm = data[up + x], tr = data[up + x + 1];
      const ml = data[mid + x - 1], mr = data[mid + x + 1];
      const bl = data[down + x - 1], bm = data[down + x], br = data[down + x + 1];
      gx[mid + x] = (-tl + tr) + (-2 * ml + 2 * mr) + (-bl + br);
      gy[mid + x] = (tl + 2 * tm + tr) - (bl + 2 * bm + br);
    }
  }
  return { gx, gy };
}

/** Separable box blur, clamp-to-edge. Smooths tensor components before
 *  eigen-analysis, the same role sigmaC plays for FDoG's own ETF. */
function boxBlur(data: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (radius <= 0) return data.slice();
  const w = 2 * radius + 1;
  const h = new Float32Array(data.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let j = 0; j < w; j++) sum += data[row + Math.max(0, Math.min(width - 1, j - radius))];
    h[row] = sum / w;
    for (let x = 1; x < width; x++) {
      sum += data[row + Math.max(0, Math.min(width - 1, x + radius))]
           - data[row + Math.max(0, Math.min(width - 1, x - 1 - radius))];
      h[row + x] = sum / w;
    }
  }
  const out = new Float32Array(data.length);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let j = 0; j < w; j++) sum += h[Math.max(0, Math.min(height - 1, j - radius)) * width + x];
    out[x] = sum / w;
    for (let y = 1; y < height; y++) {
      sum += h[Math.max(0, Math.min(height - 1, y + radius)) * width + x]
           - h[Math.max(0, Math.min(height - 1, y - 1 - radius)) * width + x];
      out[y * width + x] = sum / w;
    }
  }
  return out;
}

export function computeStructureTensorMaps(input: ChannelImage, smoothingRadius = 2): StructureTensorMaps {
  const { width, height, data } = input;
  const { gx, gy } = sobel(data, width, height);

  const rawE = new Float32Array(data.length), rawF = new Float32Array(data.length), rawG = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    rawE[i] = gx[i] * gx[i];
    rawF[i] = gx[i] * gy[i];
    rawG[i] = gy[i] * gy[i];
  }
  const e = boxBlur(rawE, width, height, smoothingRadius);
  const f = boxBlur(rawF, width, height, smoothingRadius);
  const g = boxBlur(rawG, width, height, smoothingRadius);

  const magnitude: ChannelImage = { data: new Float32Array(data.length), width, height };
  const anisotropy: ChannelImage = { data: new Float32Array(data.length), width, height };
  for (let i = 0; i < data.length; i++) {
    const trace = e[i] + g[i];
    magnitude.data[i] = Math.sqrt(Math.max(0, trace));
    const diff = Math.sqrt((e[i] - g[i]) ** 2 + 4 * f[i] * f[i]);
    anisotropy.data[i] = trace > 1e-8 ? diff / trace : 0;
  }
  return { magnitude, anisotropy };
}
