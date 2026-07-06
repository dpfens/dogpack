"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HysteresisThresholdStrategy = exports.SoftThresholdStrategy = void 0;
const utils_1 = require("../utils");
class SoftThresholdStrategy {
    threshold(sharpened, config) {
        const output = (0, utils_1.createChannelImage)(sharpened.width, sharpened.height);
        const size = sharpened.width * sharpened.height;
        for (let i = 0; i < size; i++) {
            const u = sharpened.data[i];
            const epsilon = (0, utils_1.at)(config.epsilon, i);
            const phi = (0, utils_1.at)(config.phi, i);
            output.data[i] = u >= epsilon ? 1.0 : 1.0 + Math.tanh(phi * (u - epsilon));
        }
        return output;
    }
}
exports.SoftThresholdStrategy = SoftThresholdStrategy;
class HysteresisThresholdStrategy {
    highOffset;
    lowOffset;
    constructor(highOffset = 0.2, lowOffset = 0.2) {
        this.highOffset = highOffset;
        this.lowOffset = lowOffset;
    }
    threshold(sharpened, config) {
        const output = (0, utils_1.createChannelImage)(sharpened.width, sharpened.height);
        const { width, height } = sharpened;
        const edgeMap = (0, utils_1.createChannelImage)(width, height);
        const visited = new Uint8Array(width * height);
        // epsilonHigh/epsilonLow are now resolved per-pixel inside the loop,
        // since epsilon itself may vary per-pixel.
        for (let i = 0; i < width * height; i++) {
            const value = sharpened.data[i];
            const epsilon = (0, utils_1.at)(config.epsilon, i);
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
exports.HysteresisThresholdStrategy = HysteresisThresholdStrategy;
//# sourceMappingURL=threshold.js.map