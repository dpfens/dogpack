import { ChannelImage } from "./types.js";
import { createChannelImage, at } from "./utils.js";

export interface ThresholdStrategy {
  threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage;
}

export interface ThresholdConfig {
  epsilon: number | ChannelImage;
  phi: number | ChannelImage;
}

export class SoftThresholdStrategy implements ThresholdStrategy {
  threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage {
    const output = createChannelImage(sharpened.width, sharpened.height);
    const size = sharpened.width * sharpened.height;

    for (let i = 0; i < size; i++) {
      const u = sharpened.data[i];
      const epsilon = at(config.epsilon, i);
      const phi = at(config.phi, i);
      output.data[i] = u >= epsilon ? 1.0 : 1.0 + Math.tanh(phi * (u - epsilon));
    }

    return output;
  }
}

export class HysteresisThresholdStrategy implements ThresholdStrategy {
  constructor(
    private readonly highOffset: number = 0.2,
    private readonly lowOffset: number = 0.2
  ) {}

  threshold(sharpened: ChannelImage, config: ThresholdConfig): ChannelImage {
    const output = createChannelImage(sharpened.width, sharpened.height);
    const { width, height } = sharpened;
    const edgeMap = createChannelImage(width, height);
    const visited = new Uint8Array(width * height);

    // epsilonHigh/epsilonLow are now resolved per-pixel inside the loop,
    // since epsilon itself may vary per-pixel.
    for (let i = 0; i < width * height; i++) {
      const value = sharpened.data[i];
      const epsilon = at(config.epsilon, i);
      const epsilonHigh = epsilon + this.highOffset;
      const epsilonLow = epsilon - this.lowOffset;

      if (value >= epsilonHigh) {
        edgeMap.data[i] = 1.0;
      } else if (value >= epsilonLow) {
        edgeMap.data[i] = 0.5;
      } else {
        edgeMap.data[i] = 0.0;
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (edgeMap.data[idx] === 1.0 && !visited[idx]) {
          this.floodFill(edgeMap, visited, x, y, width, height);
        }
      }
    }

    for (let i = 0; i < width * height; i++) {
      output.data[i] = edgeMap.data[i] === 1.0 ? 1.0 : 0.0;
    }

    return output;
  }

  private floodFill(
    edgeMap: ChannelImage,
    visited: Uint8Array,
    startX: number,
    startY: number,
    width: number,
    height: number
  ): void {
    // unchanged — operates on classified edgeMap values, not epsilon directly
    const queue: Array<[number, number]> = [[startX, startY]];
    visited[startY * width + startX] = 1;

    while (queue.length > 0) {
      const [x, y] = queue.shift()!;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          const idx = ny * width + nx;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited[idx]) {
            if (edgeMap.data[idx] >= 0.5) {
              edgeMap.data[idx] = 1.0;
              visited[idx] = 1;
              queue.push([nx, ny]);
            }
          }
        }
      }
    }
  }
}