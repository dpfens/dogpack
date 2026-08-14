import { createChannelImage, at } from "./utils/index.js";
export class SoftThresholdStrategy {
    threshold(sharpened, config) {
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
/**
 * Hard black/white threshold (step function).
 * Equivalent to phi → inf in SoftThresholdStrategy, and to ThresholdModes.hard
 * in processor.ts, but expressed as a ThresholdStrategy so it can be plugged
 * into DoGConfig.thresholdStrategy (e.g. as ADoG's default, since the paper's
 * screentone output is binarized rather than soft-thresholded).
 */
export class HardThresholdStrategy {
    threshold(input, config) {
        const output = createChannelImage(input.width, input.height);
        const size = input.width * input.height;
        for (let i = 0; i < size; i++) {
            const eps = at(config.epsilon, i);
            output.data[i] = input.data[i] >= eps ? 1.0 : 0.0;
        }
        return output;
    }
}
/**
 * Canny-style double-threshold strategy with hysteresis edge linking.
 *
 * Classifies each pixel against a high and low bound derived from `epsilon`
 * (`epsilon + highOffset` and `epsilon - highOffset`... see note below) into
 * strong edge, weak edge, and background tiers then promotes weak
 * edges to strong ones if they are 8-connected to a strong edge via flood fill.
 * This suppresses isolated noise pixels while preserving continuous edge lines
 * that dip briefly below the main threshold, which a single global threshold
 * (e.g. HardThresholdStrategy) cannot do.
 *
 * Note: `phi` from ThresholdConfig is unused by this strategy. Sharpness of
 * the strong/weak/background split is controlled entirely by `highOffset` and
 * `lowOffset`, not by a tanh steepness parameter.
 */
export class HysteresisThresholdStrategy {
    highOffset;
    lowOffset;
    /**
     * @param highOffset - Amount added to `epsilon` to form the high (strong-edge)
     *   bound (default: 0.2). Pixels at or above `epsilon + highOffset` are
     *   immediately classified as strong edges (seeds for flood fill).
     * @param lowOffset - Amount subtracted from `epsilon` to form the low
     *   (weak-edge) bound (default: 0.2). Pixels at or above `epsilon - lowOffset`
     *   but below the high bound are classified as weak edges, which only survive
     *   in the output if connected to a strong edge.
     */
    constructor(highOffset = 0.2, lowOffset = 0.2) {
        this.highOffset = highOffset;
        this.lowOffset = lowOffset;
    }
    threshold(sharpened, config) {
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
            }
            else if (value >= epsilonLow) {
                edgeMap.data[i] = 0.5;
            }
            else {
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
    floodFill(edgeMap, visited, startX, startY, width, height) {
        // unchanged — operates on classified edgeMap values, not epsilon directly
        const queue = [[startX, startY]];
        visited[startY * width + startX] = 1;
        while (queue.length > 0) {
            const [x, y] = queue.shift();
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0)
                        continue;
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
//# sourceMappingURL=threshold.js.map