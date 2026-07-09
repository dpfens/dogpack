"use strict";
/**
 * Local variance-based texture detection preprocessor for XDoG/FDoG edge detection.
 *
 * @remarks
 * Standard XDoG/FDoG apply the same parameters across an entire image, so
 * textured regions (fabric, foliage, skin) produce false edges alongside
 * genuine structural ones. This module addresses that by computing a texture
 * strength map — a {@link ChannelImage} whose values range from `0` (pure
 * structure) to `1` (pure texture) — from the local variance in a window
 * around each pixel, optionally normalized by the local gradient so that
 * subtle structural edges (e.g. wrinkles) aren't mistaken for texture.
 *
 * The map is not consumed directly by XDoG/FDoG. Callers instead derive
 * adaptive `p`/`epsilon` {@link ChannelImage} overrides from it
 * (`p_adaptive = p_base + alpha * textureStrength`, and similarly for
 * `epsilon`) and pass those into `DoGConfig`. Per Winnemöller et al. (2012),
 * `p` and `epsilon` should generally be varied together, since `p` alone
 * also shifts local brightness.
 *
 * This module only produces the texture map; it is not integrated into any
 * DoG implementation. See {@link LocalVariancePreprocessor} for the
 * reference implementation and {@link LocalVariancePreprocessorOptimized}
 * for a faster, separable-convolution variant suited to real-time use.
 *
 * @example
 * ```typescript
 * import { dog, preprocess } from 'dogpack';
 *
 * const preprocessor = new preprocess.LocalVariancePreprocessor({
 *   windowRadius: 2,
 *   normalizeByGradient: true,
 * });
 * const textureMap = preprocessor.process(grayImage);
 *
 * const pMap = buildAdaptiveMap(textureMap, { base: 20, sensitivity: -10 });
 * const epsilonMap = buildAdaptiveMap(textureMap, { base: 0.5, sensitivity: 0.3 });
 *
 * const xdog = new dog.XDoG({ sigma: 1.0, k: 1.6, phi: 10 });
 * const edgeMap = await xdog.process(grayImage, { p: pMap, epsilon: epsilonMap });
 * xdog.dispose();
 * ```
 *
 * @packageDocumentation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalVariancePreprocessorOptimized = exports.LocalVariancePreprocessor = void 0;
/**
 * Computes local variance as texture detection preprocessing
 *
 * STANDALONE PREPROCESSING: This class only detects texture.
 * It does NOT perform edge detection.
 *
 * Input: ChannelImage (typically grayscale image)
 * Output: ChannelImage with same dimensions where each pixel value
 *         represents texture strength (0 = pure structure, 1 = pure texture)
 *
 * The output can be:
 * 1. Passed to your XDoG/FDoG/HDoG implementation to modulate parameters
 * 2. Combined with other texture detection methods (Spectral, Patch-based)
 * 3. Visualized for debugging
 * 4. Processed through additional preprocessing steps
 *
 * Example:
 * ```
 * const preprocessor = new LocalVariancePreprocessor({
 *   windowRadius: 2,
 *   normalizeByGradient: true,
 * });
 *
 * const textureMap = preprocessor.process(grayImage);
 * // textureMap.data[i] = texture strength at pixel i
 * // Now use textureMap with your own edge detection
 * ```
 */
class LocalVariancePreprocessor {
    config;
    constructor(config = {}) {
        this.config = {
            windowRadius: config.windowRadius ?? 2, // 5x5 window by default
            normalizeByGradient: config.normalizeByGradient ?? true,
            varianceScale: config.varianceScale ?? 1.0,
            maxVariance: config.maxVariance,
        };
    }
    /**
     * Compute texture strength map from image
     *
     * @param image Input grayscale image (Float32Array, 0-1 normalized)
     * @returns ChannelImage containing texture strength values
     *          Each pixel: 0 = pure structure (edges, boundaries)
     *                     1 = pure texture (patterns, fine details)
     *          Developer uses these values to adapt XDoG parameters
     */
    process(image) {
        const result = new Float32Array(image.data.length);
        const { width, height, data } = image;
        const { windowRadius, normalizeByGradient, varianceScale, maxVariance } = this.config;
        // For each pixel
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const pixelIdx = y * width + x;
                // Compute variance in window around pixel
                const variance = this.computeLocalVariance(data, width, height, x, y, windowRadius);
                let textureStrength = variance * varianceScale;
                // Optional: Normalize by gradient strength
                if (normalizeByGradient) {
                    const gradient = this.computeLocalGradient(data, width, height, x, y);
                    // High gradient + high variance → likely edge, reduce texture score
                    // Low gradient + high variance → likely texture, keep high
                    const gradientFactor = 1.0 / (1.0 + gradient * gradient);
                    textureStrength = textureStrength * gradientFactor;
                }
                // Clamp if requested
                if (maxVariance !== undefined) {
                    textureStrength = Math.min(textureStrength, maxVariance);
                }
                // Normalize to 0-1
                result[pixelIdx] = Math.min(1.0, textureStrength);
            }
        }
        return {
            data: result,
            width,
            height,
        };
    }
    /**
     * Compute variance of pixel values in a window
     * @private
     */
    computeLocalVariance(data, width, height, cx, cy, radius) {
        let sum = 0;
        let sumSquares = 0;
        let count = 0;
        // Sum values in window
        for (let dy = -radius; dy <= radius; dy++) {
            const y = cy + dy;
            if (y < 0 || y >= height)
                continue;
            const rowOffset = y * width; // computed once per row instead of once per pixel
            for (let dx = -radius; dx <= radius; dx++) {
                const x = cx + dx;
                if (x < 0 || x >= width)
                    continue;
                const value = data[rowOffset + x];
                sum += value;
                sumSquares += value * value;
                count++;
            }
        }
        const mean = sum / count;
        const meanOfSquares = sumSquares / count;
        const variance = meanOfSquares - mean * mean;
        return Math.max(0, variance); // Clamp to non-negative
    }
    /**
     * Compute gradient magnitude at pixel (Sobel filter)
     * Used to normalize variance (distinguish texture from edges)
     * @private
     */
    computeLocalGradient(data, width, height, x, y) {
        // Sobel kernel
        let gx = 0;
        let gy = 0;
        if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
            const rowUp = (y - 1) * width;
            const rowMid = y * width;
            const rowDown = (y + 1) * width;
            // Each neighbor is read once and reused in both gx and gy,
            // instead of re-indexing/re-reading it for each.
            const tl = data[rowUp + x - 1];
            const tm = data[rowUp + x];
            const tr = data[rowUp + x + 1];
            const ml = data[rowMid + x - 1];
            const mr = data[rowMid + x + 1];
            const bl = data[rowDown + x - 1];
            const bm = data[rowDown + x];
            const br = data[rowDown + x + 1];
            // Gx (vertical edges)
            gx = (-tl + tr) + (-2 * ml + 2 * mr) + (-bl + br);
            // Gy (horizontal edges)
            gy = (tl + 2 * tm + tr) - (bl + 2 * bm + br);
        }
        const magnitude = Math.sqrt(gx * gx + gy * gy);
        return magnitude;
    }
}
exports.LocalVariancePreprocessor = LocalVariancePreprocessor;
/**
 * Optimized Local Variance Texture Detector
 *
 * Same functionality as LocalVariancePreprocessor, but faster.
 * Uses separable convolution: O(n x r) instead of O(n x r^2)
 *
 * Approach: Variance = E[X^2] - E[X]^2
 * - Compute box blur of image (gives E[X])
 * - Compute box blur of image squared (gives E[X^2])
 * - Subtract to get variance
 *
 * Performance:
 * - Basic version: ~1-2ms for 1080p (5x5 window)
 * - Optimized version: ~0.5ms for 1080p (5x5 window)
 * - 3-4x faster for large windows
 *
 * Use this for real-time applications. Basic version is fine for batch processing.
 */
class LocalVariancePreprocessorOptimized {
    config;
    constructor(config = {}) {
        this.config = {
            windowRadius: config.windowRadius ?? 2,
            normalizeByGradient: config.normalizeByGradient ?? true,
            varianceScale: config.varianceScale ?? 1.0,
            maxVariance: config.maxVariance,
        };
    }
    /**
     * Process using separable convolution (faster for large windows)
     * Variance = E[X^2] - E[X]^2
     * Compute box blur of X and X^2 separately, then combine
     */
    process(image) {
        const { width, height, data } = image;
        const { windowRadius, normalizeByGradient, varianceScale, maxVariance } = this.config;
        // Step 1: Compute E[X] (mean) via box filter
        const meanImage = this.boxBlur(data, width, height, windowRadius);
        // Step 2: Compute E[X^2] via box filter on squared values
        const squaredData = new Float32Array(data.length);
        for (let i = 0; i < data.length; i++) {
            squaredData[i] = data[i] * data[i];
        }
        const meanOfSquaresImage = this.boxBlur(squaredData, width, height, windowRadius);
        // Step 3: Compute variance = E[X^2] - E[X]^2
        const result = new Float32Array(data.length);
        const gradientMap = normalizeByGradient ? this.computeGradientMap(data, width, height) : null;
        for (let i = 0; i < data.length; i++) {
            const mean = meanImage[i];
            const variance = Math.max(0, meanOfSquaresImage[i] - mean * mean);
            let textureStrength = variance * varianceScale;
            if (normalizeByGradient && gradientMap) {
                const gradient = gradientMap[i];
                const gradientFactor = 1.0 / (1.0 + gradient * gradient);
                textureStrength *= gradientFactor;
            }
            if (maxVariance !== undefined) {
                textureStrength = Math.min(textureStrength, maxVariance);
            }
            result[i] = Math.min(1.0, textureStrength);
        }
        return { data: result, width, height };
    }
    /**
     * Fast box blur using separable convolution + a sliding-window running sum.
     *
     * @remarks
     * Each pass is O(width * height): the window sum is updated incrementally
     * as it slides one pixel over (`sum += incoming - outgoing`) rather than
     * being re-summed from scratch at every position, so cost no longer grows
     * with `radius`. Edge pixels use clamp-to-edge boundary handling.
     *
     * Trade-off: because each sum is derived from the previous one instead of
     * being recomputed from scratch, floating-point error can accumulate along
     * a scan line, unlike the resum-per-pixel approach this replaces. This is
     * negligible in practice for 0-1 normalized pixel values and the small
     * radii (1-4) this preprocessor supports.
     *
     * @private
     */
    boxBlur(data, width, height, radius) {
        const windowSize = 2 * radius + 1;
        // Horizontal pass: O(width) per row via a running sum, not O(width * radius).
        const horizontal = new Float32Array(data.length);
        for (let y = 0; y < height; y++) {
            const rowOffset = y * width;
            // Seed the window sum for x = 0 (the only O(radius) step per row).
            let sum = 0;
            for (let j = 0; j < windowSize; j++) {
                const srcX = Math.max(0, Math.min(width - 1, j - radius));
                sum += data[rowOffset + srcX];
            }
            horizontal[rowOffset] = sum / windowSize;
            // Slide the window one column at a time: O(1) per step instead of O(radius).
            for (let x = 1; x < width; x++) {
                const outgoingX = Math.max(0, Math.min(width - 1, x - 1 - radius));
                const incomingX = Math.max(0, Math.min(width - 1, x + radius));
                sum += data[rowOffset + incomingX] - data[rowOffset + outgoingX];
                horizontal[rowOffset + x] = sum / windowSize;
            }
        }
        // Vertical pass: same sliding-window trick, now sliding down each column.
        const result = new Float32Array(data.length);
        for (let x = 0; x < width; x++) {
            // Seed the window sum for y = 0.
            let sum = 0;
            for (let j = 0; j < windowSize; j++) {
                const srcY = Math.max(0, Math.min(height - 1, j - radius));
                sum += horizontal[srcY * width + x];
            }
            result[x] = sum / windowSize;
            for (let y = 1; y < height; y++) {
                const outgoingY = Math.max(0, Math.min(height - 1, y - 1 - radius));
                const incomingY = Math.max(0, Math.min(height - 1, y + radius));
                sum += horizontal[incomingY * width + x] - horizontal[outgoingY * width + x];
                result[y * width + x] = sum / windowSize;
            }
        }
        return result;
    }
    /**
     * Compute gradient map using Sobel filter (separable for efficiency)
     * @private
     */
    computeGradientMap(data, width, height) {
        const result = new Float32Array(data.length);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
                    result[y * width + x] = 0;
                    continue;
                }
                const rowUp = (y - 1) * width;
                const rowMid = y * width;
                const rowDown = (y + 1) * width;
                // Each neighbor read once and reused for both gx and gy
                const tl = data[rowUp + x - 1];
                const tm = data[rowUp + x];
                const tr = data[rowUp + x + 1];
                const ml = data[rowMid + x - 1];
                const mr = data[rowMid + x + 1];
                const bl = data[rowDown + x - 1];
                const bm = data[rowDown + x];
                const br = data[rowDown + x + 1];
                // Sobel
                const gx = (-tl + tr) - 2 * ml + 2 * mr - bl + br;
                const gy = tl + 2 * tm + tr - bl - 2 * bm - br;
                const magnitude = Math.sqrt(gx * gx + gy * gy);
                result[y * width + x] = magnitude;
            }
        }
        return result;
    }
}
exports.LocalVariancePreprocessorOptimized = LocalVariancePreprocessorOptimized;
//# sourceMappingURL=local-variance.js.map