"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CPUGradientAlignedBlur = void 0;
/**
 * Gradient-aligned blur for FDoG
 *
 * This applies blur perpendicular to the flow direction (across edges).
 * Used for the DoG computation in FDoG, where we want to blur across
 * edges but not along them.
 */
const base_js_1 = require("../../interfaces/base.js");
const index_js_1 = require("../../utils/index.js");
const base_js_2 = require("../../base.js");
class CPUGradientAlignedBlur extends base_js_2.BaseCPUStrategy {
    backend = 'cpu';
    config;
    flowField;
    constructor(config) {
        super();
        this.flowField = config.flowField;
        this.config = { ...base_js_1.DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG, ...config };
    }
    /** CPU is always available — no environment capability to probe. */
    static async isSupported() {
        return true;
    }
    dispose() { }
    setFlowField(flowField) {
        this.flowField = flowField;
    }
    async blur(input, sigma) {
        if (sigma < 0.1) {
            return {
                data: new Float32Array(input.data),
                width: input.width,
                height: input.height,
            };
        }
        const output = (0, index_js_1.createChannelImage)(input.width, input.height);
        // Number of samples perpendicular to flow
        const halfSamples = Math.ceil(sigma * 2 / this.config.stepSize);
        const numSamples = halfSamples * 2 + 1;
        const weights = (0, index_js_1.generateGaussianKernel)(sigma, numSamples);
        for (let y = 0; y < input.height; y++) {
            for (let x = 0; x < input.width; x++) {
                const value = this.sampleAcrossFlow(input, x, y, halfSamples, weights);
                output.data[y * input.width + x] = value;
            }
        }
        return output;
    }
    /**
     * Sample perpendicular to the flow direction
     */
    sampleAcrossFlow(input, startX, startY, halfSamples, weights) {
        const stepSize = this.config.stepSize;
        let sum = 0;
        let weightSum = 0;
        // Get perpendicular direction (gradient direction)
        const tangent = this.flowField.getTangent(startX, startY);
        const gradX = -tangent.y; // Perpendicular: rotate 90 degrees
        const gradY = tangent.x;
        // Sample at center
        sum += (0, index_js_1.getPixelBilinear)(input, startX, startY) * weights[halfSamples];
        weightSum += weights[halfSamples];
        // Sample in positive gradient direction
        for (let i = 1; i <= halfSamples; i++) {
            const px = startX + gradX * stepSize * i;
            const py = startY + gradY * stepSize * i;
            if (px < -0.5 || px > input.width - 0.5 ||
                py < -0.5 || py > input.height - 0.5) {
                break;
            }
            const idx = halfSamples + i;
            sum += (0, index_js_1.getPixelBilinear)(input, px, py) * weights[idx];
            weightSum += weights[idx];
        }
        // Sample in negative gradient direction
        for (let i = 1; i <= halfSamples; i++) {
            const px = startX - gradX * stepSize * i;
            const py = startY - gradY * stepSize * i;
            if (px < -0.5 || px > input.width - 0.5 ||
                py < -0.5 || py > input.height - 0.5) {
                break;
            }
            const idx = halfSamples - i;
            sum += (0, index_js_1.getPixelBilinear)(input, px, py) * weights[idx];
            weightSum += weights[idx];
        }
        return weightSum > 0 ? sum / weightSum : 0;
    }
}
exports.CPUGradientAlignedBlur = CPUGradientAlignedBlur;
//# sourceMappingURL=cpu.js.map