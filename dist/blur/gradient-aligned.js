import { createGrayscaleImage, getPixelBilinear, generateGaussianKernel } from '../utils.js';
import { BaseCPUBlur } from './base.js';
const DEFAULT_FLOW_CONFIG = {
    kernelSizeMultiplier: 6,
    stepSize: 1.0,
};
export class CPUGradientAlignedBlur extends BaseCPUBlur {
    flowField;
    config;
    constructor(flowField, config = {}) {
        super();
        this.flowField = flowField;
        this.config = { ...DEFAULT_FLOW_CONFIG, ...config };
    }
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
        const output = createGrayscaleImage(input.width, input.height);
        // Number of samples perpendicular to flow
        const halfSamples = Math.ceil(sigma * 2 / this.config.stepSize);
        const numSamples = halfSamples * 2 + 1;
        const weights = generateGaussianKernel(sigma, numSamples);
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
        sum += getPixelBilinear(input, startX, startY) * weights[halfSamples];
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
            sum += getPixelBilinear(input, px, py) * weights[idx];
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
            sum += getPixelBilinear(input, px, py) * weights[idx];
            weightSum += weights[idx];
        }
        return weightSum > 0 ? sum / weightSum : 0;
    }
}
export class GradientAlignedBlur {
    instance;
    constructor(flowField, config = {}) {
        this.instance = new CPUGradientAlignedBlur(flowField, config);
    }
    async blur(input, sigma) {
        return this.instance.blur(input, sigma);
    }
    setFlowField(flowField) {
        if (this.instance.setFlowField) {
            this.instance.setFlowField(flowField);
        }
    }
    dispose() {
        if (this.instance.dispose) {
            this.instance.dispose();
        }
    }
}
//# sourceMappingURL=gradient-aligned.js.map