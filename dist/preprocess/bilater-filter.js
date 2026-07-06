import { createChannelImage } from "../utils.js";
/**
 * Edge-preserving smoothing filter. Standalone preprocessing utility —
 * not part of ThresholdStrategy. Compose manually:
 *
 *   const sharpened = await dog.processNoThreshold(input);
 *   const smoothed = bilateralFilter(sharpened, radius, sigmaIntensity);
 *   const result = new SoftThresholdStrategy().threshold(smoothed, { epsilon, phi });
 */
export function bilateralFilter(image, radius = 3, sigmaIntensity = 0.2) {
    const output = createChannelImage(image.width, image.height);
    const { width, height, data } = image;
    const sigmaSpatial = radius / 2;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const centerValue = data[idx];
            let weightedSum = 0;
            let weightSum = 0;
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const ny = y + dy;
                    const nx = x + dx;
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        const neighborValue = data[ny * width + nx];
                        const spatialDist = Math.sqrt(dx * dx + dy * dy);
                        const spatialWeight = Math.exp(-(spatialDist * spatialDist) / (2 * sigmaSpatial * sigmaSpatial));
                        const intensityDiff = neighborValue - centerValue;
                        const intensityWeight = Math.exp(-(intensityDiff * intensityDiff) / (2 * sigmaIntensity * sigmaIntensity));
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
//# sourceMappingURL=bilater-filter.js.map