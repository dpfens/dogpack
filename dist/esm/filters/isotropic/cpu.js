/**
 * Blur strategies for DoG processing
 *
 * Provides both isotropic (standard) and anisotropic (flow-guided) blur
 * implementations for use in XDoG and FDoG pipelines.
 *
 * Supports parallel/concurrent blur operations
 */
import { DEFAULT_ISOTROPIC_BLUR_CONFIG } from '../../interfaces/base.js';
import { createChannelImage, getPixel, } from '../../utils/image.js';
import { BaseCPUStrategy } from '../../base.js';
import { generateGaussianKernel } from '../../utils/math.js';
/**
 * Compute kernel size from sigma
 * Paper samples at all integer locations less than 2x sigma for flow-aligned,
 * and extends to 2.45 * sigma for structure tensor blur
 *
 * @param sigma Standard deviation
 * @param multiplier Size multiplier (default 6 = 3*sigma on each side)
 */
function computeKernelSize(sigma, multiplier = 6) {
    // Ensure odd size for symmetric kernel
    return Math.max(3, Math.floor(sigma * multiplier) | 1);
}
/**
 * Standard isotropic Gaussian blur using separable convolution
 * This is the blur used in basic XDoG
 */
export class CPUIsotropicFilter extends BaseCPUStrategy {
    /** CPU is always available */
    static async isSupported() {
        return true;
    }
    dispose() { }
    async apply(input, config) {
        const cfg = { ...DEFAULT_ISOTROPIC_BLUR_CONFIG, ...config };
        const { sigma } = cfg;
        if (sigma < 0.1) {
            // For very small sigma, just return a copy
            return {
                data: new Float32Array(input.data),
                width: input.width,
                height: input.height,
            };
        }
        // Compute kernel size (odd number)
        const kernelSize = computeKernelSize(sigma, cfg.kernelSizeMultiplier);
        const kernel = generateGaussianKernel(sigma, kernelSize);
        const halfKernel = Math.floor(kernelSize / 2);
        // Separable convolution: horizontal pass
        const temp = createChannelImage(input.width, input.height);
        for (let y = 0; y < input.height; y++) {
            for (let x = 0; x < input.width; x++) {
                let sum = 0;
                for (let k = 0; k < kernelSize; k++) {
                    const sampleX = x + k - halfKernel;
                    sum += getPixel(input, sampleX, y) * kernel[k];
                }
                temp.data[y * input.width + x] = sum;
            }
        }
        // Separable convolution: vertical pass
        const output = createChannelImage(input.width, input.height);
        for (let y = 0; y < input.height; y++) {
            for (let x = 0; x < input.width; x++) {
                let sum = 0;
                for (let k = 0; k < kernelSize; k++) {
                    const sampleY = y + k - halfKernel;
                    sum += getPixel(temp, x, sampleY) * kernel[k];
                }
                output.data[y * input.width + x] = sum;
            }
        }
        return output;
    }
}
//# sourceMappingURL=cpu.js.map