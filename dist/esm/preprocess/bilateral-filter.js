import { createChannelImage } from '../utils/index.js';
/**
 * Edge-preserving smoothing filter. Standalone preprocessing utility —
 * not part of ThresholdStrategy. Compose manually:
 *
 *   const sharpened = await dog.processNoThreshold(input);
 *   const smoothed = new BilateralFilter(radius, sigmaIntensity).process(sharpened);
 *   const result = new SoftThresholdStrategy().threshold(smoothed, { epsilon, phi });
 */
export class BilateralFilter {
    radius;
    sigmaIntensity;
    constructor(radius = 3, sigmaIntensity = 0.2) {
        this.radius = radius;
        this.sigmaIntensity = sigmaIntensity;
    }
    process(input) {
        const output = createChannelImage(input.width, input.height);
        const { width, height, data } = input;
        const sigmaSpatial = this.radius / 2;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const centerValue = data[idx];
                let weightedSum = 0;
                let weightSum = 0;
                for (let dy = -this.radius; dy <= this.radius; dy++) {
                    for (let dx = -this.radius; dx <= this.radius; dx++) {
                        const ny = y + dy;
                        const nx = x + dx;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const neighborValue = data[ny * width + nx];
                            const spatialDist = Math.sqrt(dx * dx + dy * dy);
                            const spatialWeight = Math.exp(-(spatialDist * spatialDist) / (2 * sigmaSpatial * sigmaSpatial));
                            const intensityDiff = neighborValue - centerValue;
                            const intensityWeight = Math.exp(-(intensityDiff * intensityDiff) / (2 * this.sigmaIntensity * this.sigmaIntensity));
                            const weight = spatialWeight * intensityWeight;
                            weightedSum += neighborValue * weight;
                            weightSum += weight;
                        }
                    }
                }
                output.data[idx] = weightedSum / weightSum;
            }
        }
        return output;
    }
    ;
}
//# sourceMappingURL=bilateral-filter.js.map