/**
 * CPU Edge Tangent Flow computation for FDoG
 *
 * The ETF represents the direction of edges at each pixel, computed from
 * the structure tensor of the image gradients.
 *
 * Based on Section 2.6 of Winnemöller et al. (2012) and
 * Kang et al. (2007) "Coherent Line Drawing"
 *
 * Multi-channel support follows Di Zenzo's approach ("A note on the
 * gradient of a multi-image", CVGIP 33, 1986): per-channel structure
 * tensors are summed (not the resulting tangents), and a single
 * eigendecomposition is performed on the combined tensor. Everything
 * from smoothing onward is identical regardless of how many channels
 * fed into the tensor, so the single-channel and multi-channel paths
 * share one pipeline.
 *
 * This module has no knowledge of color spaces. It operates purely on
 * ChannelImage scalar fields; RGB/Lab/etc. splitting and conversion is
 * the caller's responsibility (see utils/color.ts) and happens before
 * compute()/computeMultiChannel() is ever called.
 */
import { DEFAULT_ETF_CONFIG } from '../interfaces/base.js';
import { normalizeVec2, dotVec2, generateGaussianKernel } from '../utils/index.js';
import { TangentFlowField } from './flow-field.js';
import { BaseCPUStrategy } from '../base.js';
/**
 * CPU-backed ETFComputer. Synchronous under the hood, but exposes the
 * same async ETFComputer contract as the WebGL/WebGPU backends so callers
 * can swap implementations without caring which one they have.
 */
export class CpuEdgeTangentFlowComputer extends BaseCPUStrategy {
    async compute(input, config = {}, sigmaC) {
        const { flowField } = await this.computeDetailed(input, config, sigmaC);
        return flowField;
    }
    async computeMultiChannel(inputs, config = {}, sigmaC) {
        const { flowField } = await this.computeMultiChannelDetailed(inputs, config, sigmaC);
        return flowField;
    }
    async computeDetailed(input, config = {}, sigmaC) {
        const channelTensor = computeChannelTensor(input);
        return buildFlowField(channelTensor, input.width, input.height, config, sigmaC);
    }
    async computeMultiChannelDetailed(inputs, config = {}, sigmaC) {
        this.validateChannels(inputs);
        const { width, height } = inputs[0];
        const channelTensors = inputs.map(computeChannelTensor);
        const combined = sumChannelTensors(channelTensors, width, height);
        return buildFlowField(combined, width, height, config, sigmaC);
    }
    validateChannels(inputs) {
        if (inputs.length === 0) {
            throw new Error('computeMultiChannel requires at least one channel');
        }
        const { width, height } = inputs[0];
        for (const channel of inputs) {
            if (channel.width !== width || channel.height !== height) {
                throw new Error('All channels passed to computeMultiChannel must share the same dimensions');
            }
        }
    }
}
/**
 * Shared pipeline: smoothing, eigendecomposition, and iterative
 * refinement, given a (possibly channel-summed) structure tensor. This is
 * the single composition point used by both compute() and
 * computeMultiChannel() above.
 */
function buildFlowField(channelTensor, width, height, config, sigmaC) {
    const cfg = { ...DEFAULT_ETF_CONFIG, ...config };
    const smoothSigma = sigmaC ?? (cfg.kernelSize / 2.45);
    const smoothedTensor = smoothStructureTensorGaussian(channelTensor.tensor, width, height, smoothSigma);
    let tangents = extractTangentField(smoothedTensor, width, height);
    for (let i = 0; i < cfg.iterations; i++) {
        tangents = refineTangentField(tangents, channelTensor.magnitude, width, height);
    }
    return {
        flowField: TangentFlowField.fromVec2Array(tangents, width, height),
        magnitude: { data: channelTensor.magnitude, width, height },
    };
}
/**
 * Compute a channel's structure tensor and its trace-derived magnitude
 * field in one step. This is the single composition point shared by
 * compute() (called once) and computeMultiChannel() (called once per
 * input channel, then combined via sumChannelTensors).
 */
function computeChannelTensor(input) {
    const tensor = buildStructureTensor(computeGradients(input), input.width, input.height);
    const magnitude = tensorMagnitude(tensor, input.width * input.height);
    return { tensor, magnitude };
}
/**
 * Di Zenzo tensor summation: combine several channels' structure tensors
 * (and their magnitudes) into one. Valid because E, F, G, and the
 * trace-derived magnitude are all additive across channels — this is
 * the mathematical basis for treating multi-channel ETF as "the same
 * as single-channel, but with a summed tensor."
 */
function sumChannelTensors(channelTensors, width, height) {
    const size = width * height;
    const e = new Float32Array(size);
    const f = new Float32Array(size);
    const g = new Float32Array(size);
    for (const { tensor } of channelTensors) {
        for (let i = 0; i < size; i++) {
            e[i] += tensor.e[i];
            f[i] += tensor.f[i];
            g[i] += tensor.g[i];
        }
    }
    const magnitude = tensorMagnitude({ e, f, g }, size);
    return { tensor: { e, f, g }, magnitude };
}
/**
 * Derive the scalar gradient-magnitude field from a structure tensor's
 * trace: sqrt(E + G) == sqrt(Ix² + Iy²) == hypot(Ix, Iy) for a single
 * channel, so this is a drop-in replacement for a Sobel-derived
 * magnitude field, but one that also composes correctly across summed
 * multi-channel tensors.
 */
function tensorMagnitude(tensor, size) {
    const magnitude = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        magnitude[i] = Math.sqrt(tensor.e[i] + tensor.g[i]);
    }
    return magnitude;
}
/**
 * Compute image gradients using Sobel operator
 */
function computeGradients(input) {
    const { width, height } = input;
    const size = width * height;
    const gradX = new Float32Array(size);
    const gradY = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        const x = i % width;
        const y = Math.floor(i / width);
        if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
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
            gradX[i] = -p00 + p20 - 2 * p01 + 2 * p21 - p02 + p22;
            gradY[i] = -p00 - 2 * p10 - p20 + p02 + 2 * p12 + p22;
        }
    }
    return { x: gradX, y: gradY };
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