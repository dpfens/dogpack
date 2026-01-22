/**
 * Edge Tangent Flow computation for FDoG
 *
 * The ETF represents the direction of edges at each pixel, computed from
 * the structure tensor of the image gradients.
 *
 * Based on Section 2.6 of Winnemöller et al. (2012) and
 * Kang et al. (2007) "Coherent Line Drawing"
 */
import { DEFAULT_ETF_CONFIG } from '../types.js';
import { createGrayscaleImage, normalizeVec2, dotVec2, generateGaussianKernel } from '../utils.js';
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
     * Get all tangents as a flat array (for GPU upload)
     */
    getTangentArray() {
        const result = new Float32Array(this.width * this.height * 2);
        for (let i = 0; i < this.tangents.length; i++) {
            result[i * 2] = this.tangents[i].x;
            result[i * 2 + 1] = this.tangents[i].y;
        }
        return result;
    }
    /**
     * Compute Edge Tangent Flow from a grayscale image
     *
     * @param input Grayscale image (values in 0-1)
     * @param config ETF configuration
     * @param sigmaC Structure tensor smoothing sigma (optional override)
     */
    static compute(input, config = {}, sigmaC) {
        const cfg = { ...DEFAULT_ETF_CONFIG, ...config };
        const { width, height } = input;
        // Step 1: Compute image gradients using Sobel operator
        const gradients = computeGradients(input);
        // Step 2: Build structure tensor from gradients
        const tensor = buildStructureTensor(gradients, width, height);
        // Step 3: Smooth the structure tensor with Gaussian (not box filter!)
        // Paper specifies sampling within 2.45 * σc for structure tensor blur
        const smoothSigma = sigmaC ?? (cfg.kernelSize / 2.45);
        const smoothedTensor = smoothStructureTensorGaussian(tensor, width, height, smoothSigma);
        // Step 4: Extract initial tangent field from smoothed tensor
        let tangents = extractTangentField(smoothedTensor, width, height);
        // Step 5: Refine tangent field iteratively
        for (let i = 0; i < cfg.iterations; i++) {
            tangents = refineTangentField(tangents, gradients.magnitude, width, height);
        }
        return new EdgeTangentFlow(tangents, width, height);
    }
    /**
     * Visualize the flow field as a grayscale image
     * Encodes direction as intensity (useful for debugging)
     */
    visualize() {
        const output = createGrayscaleImage(this.width, this.height);
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const idx = y * this.width + x;
                const t = this.tangents[idx];
                // Convert direction to angle, then to 0-1 range
                const angle = Math.atan2(t.y, t.x);
                output.data[idx] = (angle + Math.PI) / (2 * Math.PI);
            }
        }
        return output;
    }
    /**
     * Visualize as a color image (HSV with direction as hue)
     */
    visualizeColor() {
        const imageData = new ImageData(this.width, this.height);
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const idx = y * this.width + x;
                const t = this.tangents[idx];
                // Direction as hue
                const angle = Math.atan2(t.y, t.x);
                const hue = (angle + Math.PI) / (2 * Math.PI);
                // Magnitude as saturation (always 1 for normalized vectors)
                const saturation = 1;
                const value = 1;
                // HSV to RGB
                const [r, g, b] = hsvToRgb(hue, saturation, value);
                const i = idx * 4;
                imageData.data[i] = r;
                imageData.data[i + 1] = g;
                imageData.data[i + 2] = b;
                imageData.data[i + 3] = 255;
            }
        }
        return imageData;
    }
}
/**
 * Convert HSV to RGB
 */
function hsvToRgb(h, s, v) {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    let r, g, b;
    switch (i % 6) {
        case 0:
            r = v;
            g = t;
            b = p;
            break;
        case 1:
            r = q;
            g = v;
            b = p;
            break;
        case 2:
            r = p;
            g = v;
            b = t;
            break;
        case 3:
            r = p;
            g = q;
            b = v;
            break;
        case 4:
            r = t;
            g = p;
            b = v;
            break;
        case 5:
            r = v;
            g = p;
            b = q;
            break;
        default:
            r = 0;
            g = 0;
            b = 0;
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
/**
 * Compute image gradients using Sobel operator
 */
// In etf.ts - Optimize gradient computation
function computeGradients(input) {
    const { width, height } = input;
    const size = width * height;
    const gradX = new Float32Array(size);
    const gradY = new Float32Array(size);
    const magnitude = new Float32Array(size);
    // Precompute pixel indices for better cache locality
    const indices = new Int32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            indices[y * width + x] = y * width + x;
        }
    }
    // Use SIMD-like operations (manual loop unrolling)
    for (let i = 0; i < size; i++) {
        const x = i % width;
        const y = Math.floor(i / width);
        if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
            // Use direct array access instead of getPixel calls
            const idx = y * width + x;
            const idxTop = idx - width;
            const idxBottom = idx + width;
            const p00 = input.data[idxTop - 1];
            const p10 = input.data[idxTop];
            const p20 = input.data[idxTop + 1];
            const p01 = input.data[idx - 1];
            const p21 = input.data[idx + 1];
            const p02 = input.data[idxBottom - 1];
            const p12 = input.data[idxBottom];
            const p22 = input.data[idxBottom + 1];
            const gx = -p00 + p20 - 2 * p01 + 2 * p21 - p02 + p22;
            const gy = -p00 - 2 * p10 - p20 + p02 + 2 * p12 + p22;
            gradX[i] = gx;
            gradY[i] = gy;
            magnitude[i] = Math.hypot(gx, gy); // Faster than sqrt(gx*gx + gy*gy)
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
 * Smooth the structure tensor with Gaussian filter
 *
 * Paper specifies Gaussian smoothing (not box filter!) with sampling
 * extended to all pixels within 2.45 * σc
 */
function smoothStructureTensorGaussian(tensor, width, height, sigma) {
    const size = width * height;
    // Kernel size based on paper's 2.45σ sampling rule
    const radius = Math.ceil(sigma * 2.45);
    const kernelSize = radius * 2 + 1;
    const kernel = generateGaussianKernel(sigma, kernelSize);
    // Separable Gaussian blur for each component
    const smoothE = gaussianBlur2D(tensor.e, width, height, kernel, radius);
    const smoothF = gaussianBlur2D(tensor.f, width, height, kernel, radius);
    const smoothG = gaussianBlur2D(tensor.g, width, height, kernel, radius);
    return { e: smoothE, f: smoothF, g: smoothG };
}
/**
 * Apply 2D Gaussian blur using separable convolution
 */
function gaussianBlur2D(input, width, height, kernel, radius) {
    const size = width * height;
    const temp = new Float32Array(size);
    const output = new Float32Array(size);
    const kernelSize = kernel.length;
    // Horizontal pass
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let sum = 0;
            for (let k = 0; k < kernelSize; k++) {
                const sx = Math.max(0, Math.min(width - 1, x + k - radius));
                sum += input[y * width + sx] * kernel[k];
            }
            temp[y * width + x] = sum;
        }
    }
    // Vertical pass
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let sum = 0;
            for (let k = 0; k < kernelSize; k++) {
                const sy = Math.max(0, Math.min(height - 1, y + k - radius));
                sum += temp[sy * width + x] * kernel[k];
            }
            output[y * width + x] = sum;
        }
    }
    return output;
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
//# sourceMappingURL=cpu.js.map