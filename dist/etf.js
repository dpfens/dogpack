/**
 * Edge Tangent Flow computation for FDoG
 *
 * The ETF represents the direction of edges at each pixel, computed from
 * the structure tensor of the image gradients.
 */
import { DEFAULT_ETF_CONFIG } from './types.js';
import { getPixel, normalizeVec2, dotVec2 } from './utils.js';
/**
 * Edge Tangent Flow field implementation
 */
export class EdgeTangentFlow {
    tangents;
    width;
    height;
    constructor(tangents, width, height) {
        this.tangents = tangents;
        this.width = width;
        this.height = height;
    }
    getTangent(x, y) {
        const clampedX = Math.max(0, Math.min(this.width - 1, Math.round(x)));
        const clampedY = Math.max(0, Math.min(this.height - 1, Math.round(y)));
        return this.tangents[clampedY * this.width + clampedX];
    }
    /**
     * Compute Edge Tangent Flow from a grayscale image
     */
    static compute(input, config = {}) {
        const cfg = { ...DEFAULT_ETF_CONFIG, ...config };
        const { width, height } = input;
        // Step 1: Compute image gradients using Sobel operator
        const gradients = computeGradients(input);
        // Step 2: Build structure tensor from gradients
        const tensor = buildStructureTensor(gradients, width, height);
        // Step 3: Smooth the structure tensor
        const smoothedTensor = smoothStructureTensor(tensor, width, height, cfg.kernelSize);
        // Step 4: Extract initial tangent field from smoothed tensor
        let tangents = extractTangentField(smoothedTensor, width, height);
        // Step 5: Refine tangent field iteratively
        for (let i = 0; i < cfg.iterations; i++) {
            tangents = refineTangentField(tangents, gradients.magnitude, width, height);
        }
        return new EdgeTangentFlow(tangents, width, height);
    }
}
/**
 * Compute image gradients using Sobel operator
 */
function computeGradients(input) {
    const { width, height } = input;
    const size = width * height;
    const gradX = new Float32Array(size);
    const gradY = new Float32Array(size);
    const magnitude = new Float32Array(size);
    // Sobel kernels
    // Gx: [-1 0 1]    Gy: [-1 -2 -1]
    //     [-2 0 2]        [ 0  0  0]
    //     [-1 0 1]        [ 1  2  1]
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            // Sample 3x3 neighborhood
            const p00 = getPixel(input, x - 1, y - 1);
            const p10 = getPixel(input, x, y - 1);
            const p20 = getPixel(input, x + 1, y - 1);
            const p01 = getPixel(input, x - 1, y);
            const p21 = getPixel(input, x + 1, y);
            const p02 = getPixel(input, x - 1, y + 1);
            const p12 = getPixel(input, x, y + 1);
            const p22 = getPixel(input, x + 1, y + 1);
            // Sobel gradients
            const gx = -p00 + p20 - 2 * p01 + 2 * p21 - p02 + p22;
            const gy = -p00 - 2 * p10 - p20 + p02 + 2 * p12 + p22;
            gradX[idx] = gx;
            gradY[idx] = gy;
            magnitude[idx] = Math.sqrt(gx * gx + gy * gy);
        }
    }
    return { x: gradX, y: gradY, magnitude };
}
/**
 * Build structure tensor from gradients
 */
function buildStructureTensor(gradients, width, height) {
    const size = width * height;
    const e = new Float32Array(size);
    const f = new Float32Array(size);
    const g = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        const gx = gradients.x[i];
        const gy = gradients.y[i];
        e[i] = gx * gx;
        f[i] = gx * gy;
        g[i] = gy * gy;
    }
    return { e, f, g };
}
/**
 * Smooth the structure tensor with a box filter
 */
function smoothStructureTensor(tensor, width, height, kernelSize) {
    const half = Math.floor(kernelSize / 2);
    const size = width * height;
    const smoothE = new Float32Array(size);
    const smoothF = new Float32Array(size);
    const smoothG = new Float32Array(size);
    // Simple box filter (could be optimized with separable passes)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let sumE = 0, sumF = 0, sumG = 0;
            let count = 0;
            for (let ky = -half; ky <= half; ky++) {
                for (let kx = -half; kx <= half; kx++) {
                    const sx = x + kx;
                    const sy = y + ky;
                    if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
                        const idx = sy * width + sx;
                        sumE += tensor.e[idx];
                        sumF += tensor.f[idx];
                        sumG += tensor.g[idx];
                        count++;
                    }
                }
            }
            const idx = y * width + x;
            smoothE[idx] = sumE / count;
            smoothF[idx] = sumF / count;
            smoothG[idx] = sumG / count;
        }
    }
    return { e: smoothE, f: smoothF, g: smoothG };
}
/**
 * Extract tangent field from structure tensor
 * The tangent is perpendicular to the gradient direction (i.e., along the edge)
 */
function extractTangentField(tensor, width, height) {
    const size = width * height;
    const tangents = new Array(size);
    for (let i = 0; i < size; i++) {
        const e = tensor.e[i];
        const f = tensor.f[i];
        const g = tensor.g[i];
        // Compute eigenvector corresponding to smallest eigenvalue
        // This gives the direction perpendicular to the gradient (along the edge)
        // For 2x2 symmetric matrix, we can compute directly
        const diff = e - g;
        const disc = Math.sqrt(diff * diff + 4 * f * f);
        // Eigenvector for smaller eigenvalue
        let tx, ty;
        if (Math.abs(f) > 1e-10) {
            // Standard case
            const lambda1 = (e + g - disc) / 2;
            tx = lambda1 - g;
            ty = f;
        }
        else if (e < g) {
            // f ≈ 0 and e < g: eigenvector is (1, 0)
            tx = 1;
            ty = 0;
        }
        else {
            // f ≈ 0 and e >= g: eigenvector is (0, 1)
            tx = 0;
            ty = 1;
        }
        tangents[i] = normalizeVec2({ x: tx, y: ty });
    }
    return tangents;
}
/**
 * Refine tangent field by smoothing while preserving edge direction consistency
 * This is the key step that makes lines coherent
 */
function refineTangentField(tangents, magnitude, width, height) {
    const size = width * height;
    const refined = new Array(size);
    const kernelRadius = 2;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const currentT = tangents[idx];
            const currentMag = magnitude[idx];
            let sumX = 0;
            let sumY = 0;
            let weightSum = 0;
            // Weighted average of neighboring tangents
            for (let ky = -kernelRadius; ky <= kernelRadius; ky++) {
                for (let kx = -kernelRadius; kx <= kernelRadius; kx++) {
                    const nx = x + kx;
                    const ny = y + ky;
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        const nidx = ny * width + nx;
                        const neighborT = tangents[nidx];
                        const neighborMag = magnitude[nidx];
                        // Spatial weight (simple box, could use Gaussian)
                        const spatialWeight = 1.0;
                        // Magnitude weight (prefer strong edges)
                        const magWeight = neighborMag;
                        // Direction weight (prefer similar directions)
                        // Use dot product, but handle sign flip (tangent can point either way)
                        const dot = dotVec2(currentT, neighborT);
                        const sign = dot >= 0 ? 1 : -1;
                        const dirWeight = Math.abs(dot);
                        const weight = spatialWeight * magWeight * dirWeight;
                        sumX += sign * neighborT.x * weight;
                        sumY += sign * neighborT.y * weight;
                        weightSum += weight;
                    }
                }
            }
            if (weightSum > 1e-10) {
                refined[idx] = normalizeVec2({ x: sumX / weightSum, y: sumY / weightSum });
            }
            else {
                refined[idx] = currentT;
            }
        }
    }
    return refined;
}
//# sourceMappingURL=etf.js.map