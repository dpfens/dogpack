let webglComputeSupportCache = null;
function isWebGLComputeSupported() {
    if (webglComputeSupportCache !== null)
        return webglComputeSupportCache;
    try {
        const canvas = typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(1, 1)
            : typeof document !== 'undefined'
                ? document.createElement('canvas')
                : null;
        if (!canvas) {
            webglComputeSupportCache = false;
            return webglComputeSupportCache;
        }
        const gl = canvas.getContext('webgl2');
        if (!gl) {
            webglComputeSupportCache = false;
            return webglComputeSupportCache;
        }
        // Exclude software rasterizers — too slow to be a useful compute fallback
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = debugInfo
            ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
            : '';
        const isSoftware = /swiftshader|software|llvmpipe/i.test(renderer);
        // Required for float render targets, used in most GPGPU-style passes
        const hasFloatTargets = gl.getExtension('EXT_color_buffer_float') !== null;
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        webglComputeSupportCache = !isSoftware && hasFloatTargets;
        return webglComputeSupportCache;
    }
    catch {
        webglComputeSupportCache = false;
        return webglComputeSupportCache;
    }
}
async function isWebGPUSupported() {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
        return false;
    }
    try {
        const adapter = await navigator.gpu.requestAdapter();
        return adapter !== null;
    }
    catch {
        return false;
    }
}

/**
 * Create a new grayscale image with given dimensions
 */
function createChannelImage$1(width, height) {
    return {
        data: new Float32Array(width * height),
        width,
        height,
    };
}
/**
 * Clone a grayscale image
 */
function cloneChannelImage(image) {
    return {
        data: new Float32Array(image.data),
        width: image.width,
        height: image.height,
    };
}
/**
 * Get pixel value with bounds checking (clamps to edge)
 */
function getPixel(image, x, y) {
    const clampedX = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
    const clampedY = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
    return image.data[clampedY * image.width + clampedX];
}
/**
 * Get pixel value with bilinear interpolation for sub-pixel sampling
 */
function getPixelBilinear(image, x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const fx = x - x0;
    const fy = y - y0;
    const v00 = getPixel(image, x0, y0);
    const v10 = getPixel(image, x1, y0);
    const v01 = getPixel(image, x0, y1);
    const v11 = getPixel(image, x1, y1);
    return (v00 * (1 - fx) * (1 - fy) +
        v10 * fx * (1 - fy) +
        v01 * (1 - fx) * fy +
        v11 * fx * fy);
}
/**
 * Set pixel value
 */
function setPixel(image, x, y, value) {
    if (x >= 0 && x < image.width && y >= 0 && y < image.height) {
        image.data[y * image.width + x] = value;
    }
}
/**
 * Get pixel index for coordinates
 */
function getIndex(width, x, y) {
    return y * width + x;
}
/**
 * Convert RGB image to grayscale using luminance formula
 */
function rgbToGrayscale(rgb) {
    const gray = createChannelImage$1(rgb.width, rgb.height);
    const pixelCount = rgb.width * rgb.height;
    for (let i = 0; i < pixelCount; i++) {
        const r = rgb.data[i * 3];
        const g = rgb.data[i * 3 + 1];
        const b = rgb.data[i * 3 + 2];
        // Standard luminance formula
        gray.data[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    return gray;
}
/**
 * Convert ImageData (from canvas) to grayscale image
 * Assumes values are in 0-255 range, normalizes to 0-1
 */
function imageDataToLuminance(imageData) {
    const gray = createChannelImage$1(imageData.width, imageData.height);
    const pixelCount = imageData.width * imageData.height;
    for (let i = 0; i < pixelCount; i++) {
        const r = imageData.data[i * 4] / 255;
        const g = imageData.data[i * 4 + 1] / 255;
        const b = imageData.data[i * 4 + 2] / 255;
        gray.data[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    return gray;
}
/**
 * Convert grayscale image to ImageData (for canvas display)
 * Assumes input is in 0-1 range
 *
 * @param alpha Optional per-pixel alpha (0-255), one entry per pixel in
 * the same row-major order as `gray.data`. Omit to get a fully opaque
 * image (alpha = 255 everywhere), which matches this function's original
 * behavior for callers that don't care about transparency.
 */
function luminanceToImageData(gray, alpha) {
    const imageData = new ImageData(gray.width, gray.height);
    const pixelCount = gray.width * gray.height;
    for (let i = 0; i < pixelCount; i++) {
        const value = Math.max(0, Math.min(255, Math.round(gray.data[i] * 255)));
        imageData.data[i * 4] = value;
        imageData.data[i * 4 + 1] = value;
        imageData.data[i * 4 + 2] = value;
        imageData.data[i * 4 + 3] = alpha ? alpha[i] : 255;
    }
    return imageData;
}

/**
 * Normalize a 2D vector
 */
function normalizeVec2(v) {
    const len = Math.sqrt(v.x * v.x + v.y * v.y);
    if (len < 1e-10) {
        return { x: 0, y: 0 };
    }
    return { x: v.x / len, y: v.y / len };
}
/**
 * Compute dot product of two vectors
 */
function dotVec2(a, b) {
    return a.x * b.x + a.y * b.y;
}
/**
 * Rotate vector 90 degrees counter-clockwise (perpendicular)
 */
function perpendicular(v) {
    return { x: -v.y, y: v.x };
}
/**
 * Generate 1D Gaussian kernel
 * @param sigma Standard deviation
 * @param size Kernel size (should be odd)
 * @returns Normalized Gaussian kernel
 */
function generateGaussianKernel$1(sigma, size) {
    const kernel = new Float32Array(size);
    const center = Math.floor(size / 2);
    const sigma2 = 2 * sigma * sigma;
    let sum = 0;
    for (let i = 0; i < size; i++) {
        const x = i - center;
        kernel[i] = Math.exp(-(x * x) / sigma2);
        sum += kernel[i];
    }
    // Normalize
    for (let i = 0; i < size; i++) {
        kernel[i] /= sum;
    }
    return kernel;
}
/**
 * Clamp a value to a range
 */
function clamp$1(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
/**
 * Linear interpolation
 */
function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * Color space conversion utilities
 *
 * Responsible for turning an RGBImage into a set of independent
 * ChannelImage instances, either as raw RGB channels or as CIE Lab
 * channels (L, a, b). Kept separate from the ETF/structure-tensor math
 * so that flow.ts stays focused purely on the Di Zenzo / eigen-decomposition
 * pipeline and doesn't need to know anything about color science.
 */
function createChannelImage(width, height) {
    return {
        data: new Float32Array(width * height),
        width,
        height,
    };
}
/**
 * Split an interleaved RGBImage into three independent ChannelImages,
 * one per channel, each still in 0-1 range.
 */
function splitRGBChannels(rgb) {
    const { width, height, data } = rgb;
    const size = width * height;
    const r = createChannelImage(width, height);
    const g = createChannelImage(width, height);
    const b = createChannelImage(width, height);
    for (let i = 0; i < size; i++) {
        const o = i * 3;
        r.data[i] = data[o];
        g.data[i] = data[o + 1];
        b.data[i] = data[o + 2];
    }
    return [r, g, b];
}
/**
 * Convert an interleaved RGBImage into three independent ChannelImages
 * representing CIE Lab's L, a, and b components.
 *
 * L is normalized from its native [0, 100] range to [0, 1] by dividing by 100.
 * a and b are normalized from their native (roughly [-128, 127]) range to
 * [0, 1] via (v + 128) / 255.
 *
 * This normalization is a deliberate choice: it keeps all three channels in
 * comparable numeric ranges before gradients/tensors are computed, so that
 * chroma channels don't dominate or get drowned out purely due to differing
 * native scales relative to L. Input RGB is assumed to be sRGB with values
 * in [0, 1].
 */
function rgbToLabChannels(rgb) {
    const { width, height, data } = rgb;
    const size = width * height;
    const l = createChannelImage(width, height);
    const a = createChannelImage(width, height);
    const bCh = createChannelImage(width, height);
    for (let i = 0; i < size; i++) {
        const o = i * 3;
        const [labL, labA, labB] = srgbToLab(data[o], data[o + 1], data[o + 2]);
        l.data[i] = labL / 100;
        a.data[i] = (labA + 128) / 255;
        bCh.data[i] = (labB + 128) / 255;
    }
    return [l, a, bCh];
}
/**
 * Convert a single sRGB pixel (each component in [0, 1]) to CIE Lab
 * (D65 white point). L is in [0, 100]; a and b are roughly in [-128, 127]
 * but are not hard-clamped.
 */
function srgbToLab(r, g, b) {
    const [x, y, z] = srgbToXyz(r, g, b);
    return xyzToLab(x, y, z);
}
// D65 reference white, 2-degree observer
const REF_X = 0.95047;
const REF_Y = 1.0;
const REF_Z = 1.08883;
function srgbChannelToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function srgbToXyz(r, g, b) {
    const lr = srgbChannelToLinear(r);
    const lg = srgbChannelToLinear(g);
    const lb = srgbChannelToLinear(b);
    // sRGB -> XYZ (D65) matrix
    const x = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
    const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750;
    const z = lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041;
    return [x, y, z];
}
function xyzToLab(x, y, z) {
    const fx = labF(x / REF_X);
    const fy = labF(y / REF_Y);
    const fz = labF(z / REF_Z);
    const l = 116 * fy - 16;
    const a = 500 * (fx - fy);
    const b = 200 * (fy - fz);
    return [l, a, b];
}
function labF(t) {
    const delta = 6 / 29;
    return t > delta ** 3 ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29;
}

var color = /*#__PURE__*/Object.freeze({
    __proto__: null,
    rgbToLabChannels: rgbToLabChannels,
    splitRGBChannels: splitRGBChannels,
    srgbToLab: srgbToLab
});

/**
 * Image utility functions
 */
/**
 * Reads a value that may be a scalar (uniform) or a per-pixel ChannelImage.
 */
function at(value, i) {
    return typeof value === "number" ? value : value.data[i];
}

var index$6 = /*#__PURE__*/Object.freeze({
    __proto__: null,
    at: at,
    clamp: clamp$1,
    cloneChannelImage: cloneChannelImage,
    color: color,
    createChannelImage: createChannelImage$1,
    dotVec2: dotVec2,
    generateGaussianKernel: generateGaussianKernel$1,
    getIndex: getIndex,
    getPixel: getPixel,
    getPixelBilinear: getPixelBilinear,
    imageDataToLuminance: imageDataToLuminance,
    isWebGLComputeSupported: isWebGLComputeSupported,
    isWebGPUSupported: isWebGPUSupported,
    lerp: lerp,
    luminanceToImageData: luminanceToImageData,
    normalizeVec2: normalizeVec2,
    perpendicular: perpendicular,
    rgbToGrayscale: rgbToGrayscale,
    setPixel: setPixel
});

class SoftThresholdStrategy {
    threshold(sharpened, config) {
        const output = createChannelImage$1(sharpened.width, sharpened.height);
        const size = sharpened.width * sharpened.height;
        for (let i = 0; i < size; i++) {
            const u = sharpened.data[i];
            const epsilon = at(config.epsilon, i);
            const phi = at(config.phi, i);
            output.data[i] = u >= epsilon ? 1.0 : 1.0 + Math.tanh(phi * (u - epsilon));
        }
        return output;
    }
}
/**
 * Hard black/white threshold (step function).
 * Equivalent to phi -> inf in SoftThresholdStrategy, and to ThresholdModes.hard
 * in processor.ts, but expressed as a ThresholdStrategy so it can be plugged
 * into DoGConfig.thresholdStrategy (e.g. as ADoG's default, since the paper's
 * screentone output is binarized rather than soft-thresholded).
 */
class HardThresholdStrategy {
    threshold(input, config) {
        const output = createChannelImage$1(input.width, input.height);
        const size = input.width * input.height;
        for (let i = 0; i < size; i++) {
            const eps = at(config.epsilon, i);
            output.data[i] = input.data[i] >= eps ? 1.0 : 0.0;
        }
        return output;
    }
}
/**
 * Canny-style double-threshold strategy with hysteresis edge linking.
 *
 * Classifies each pixel against a high and low bound derived from `epsilon`
 * (`epsilon + highOffset` and `epsilon - highOffset`... see note below) into
 * strong edge, weak edge, and background tiers then promotes weak
 * edges to strong ones if they are 8-connected to a strong edge via flood fill.
 * This suppresses isolated noise pixels while preserving continuous edge lines
 * that dip briefly below the main threshold, which a single global threshold
 * (e.g. HardThresholdStrategy) cannot do.
 *
 * Note: `phi` from ThresholdConfig is unused by this strategy. Sharpness of
 * the strong/weak/background split is controlled entirely by `highOffset` and
 * `lowOffset`, not by a tanh steepness parameter.
 */
class HysteresisThresholdStrategy {
    highOffset;
    lowOffset;
    /**
     * @param highOffset - Amount added to `epsilon` to form the high (strong-edge)
     *   bound (default: 0.2). Pixels at or above `epsilon + highOffset` are
     *   immediately classified as strong edges (seeds for flood fill).
     * @param lowOffset - Amount subtracted from `epsilon` to form the low
     *   (weak-edge) bound (default: 0.2). Pixels at or above `epsilon - lowOffset`
     *   but below the high bound are classified as weak edges, which only survive
     *   in the output if connected to a strong edge.
     */
    constructor(highOffset = 0.2, lowOffset = 0.2) {
        this.highOffset = highOffset;
        this.lowOffset = lowOffset;
    }
    threshold(sharpened, config) {
        const output = createChannelImage$1(sharpened.width, sharpened.height);
        const { width, height } = sharpened;
        const edgeMap = createChannelImage$1(width, height);
        const visited = new Uint8Array(width * height);
        // epsilonHigh/epsilonLow are now resolved per-pixel inside the loop,
        // since epsilon itself may vary per-pixel.
        for (let i = 0; i < width * height; i++) {
            const value = sharpened.data[i];
            const epsilon = at(config.epsilon, i);
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

var threshold = /*#__PURE__*/Object.freeze({
    __proto__: null,
    HardThresholdStrategy: HardThresholdStrategy,
    HysteresisThresholdStrategy: HysteresisThresholdStrategy,
    SoftThresholdStrategy: SoftThresholdStrategy
});

/**
 * Base DoG / XDoG parameter ranges.
 *
 * Recommended ranges follow the span of settings in Table A.1 of
 * Winnemöller et al., "XDoG: An eXtended difference-of-Gaussians
 * compendium" (Computers & Graphics 36(6), 2012), which is the reference
 * for the reparameterized (σ, k, p, φ, ε) formulation used here. In that
 * table p ranges 15.7–120, φ ranges 0.01–10.3 (with φ >> 0.01 pushing the
 * soft tanh ramp toward a step function — Sec. 4.1), and ε ranges 72.6–100
 * on the paper's 0–100 luminance scale, i.e. ~0.73–1.0 once normalized.
 * σe (== `sigma` here) ranges 0.8–6.8 across natural-media styles.
 * k = 1.6 is Marr & Hildreth's engineering trade-off (Sec. 2.3).
 */
const DOG_PARAM_RANGES = {
    sigma: { hardMin: 0, hardMax: Infinity, recommendedMin: 0.4, recommendedMax: 7.0, default: 1.0, step: 0.1 },
    k: { hardMin: 1.0, hardMax: Infinity, recommendedMin: 1.4, recommendedMax: 1.6, default: 1.6, step: 0.01 },
    p: { hardMin: 0, hardMax: Infinity, recommendedMin: 0, recommendedMax: 120, default: 20, step: 1 },
    epsilon: { hardMin: 0, hardMax: 1, recommendedMin: 0.5, recommendedMax: 1.0, default: 0.5, step: 0.01 },
    phi: { hardMin: 0, hardMax: Infinity, recommendedMin: 0.01, recommendedMax: 200, default: 10, step: 0.5 },
};
/**
 * XDoG-specific parameter ranges (on top of DOG_PARAM_RANGES).
 *
 * kernelSizeMultiplier is the Gaussian truncation radius as a multiple of
 * σ. Winnemöller samples the Gaussian out to ~2σ for the DoG passes
 * (Appendix A/B), but a wider window (≈6σ) captures the tail more fully;
 * 3σ covers ~99.7% and is the practical floor for a clean kernel.
 */
const XDOG_PARAM_RANGES = {
    ...DOG_PARAM_RANGES,
    kernelSizeMultiplier: { hardMin: 1, hardMax: Infinity, recommendedMin: 3, recommendedMax: 8, default: 6, step: 1 },
};
const FDOG_PARAM_RANGES = {
    ...DOG_PARAM_RANGES,
    sigmaC: { hardMin: 0, hardMax: Infinity, recommendedMin: 0.1, recommendedMax: 6.0, default: 2.5, step: 0.1 },
    sigmaM: { hardMin: 0, hardMax: Infinity, recommendedMin: 3.0, recommendedMax: 20.0, default: 4.0, step: 0.5 },
    sigmaA: { hardMin: 0, hardMax: Infinity, recommendedMin: 0.5, recommendedMax: 7.2, default: 1.0, step: 0.1 },
};
const FDOG_CONFIDENCE_WEIGHT_PARAM_RANGES = {
    epsilonMargin: { hardMin: 0, hardMax: 1, recommendedMin: 0, recommendedMax: 0.3, default: 0.15, step: 0.01 },
};
const ADOG_PARAM_RANGES = {
    ...DOG_PARAM_RANGES,
    kernelSizeMultiplier: XDOG_PARAM_RANGES.kernelSizeMultiplier,
    k: { hardMin: 1.0, hardMax: Infinity, recommendedMin: 1.6, recommendedMax: 1.6, default: 1.6, step: 0.01 },
    epsilon: { hardMin: 0, hardMax: 1, recommendedMin: 0.0, recommendedMax: 0.2, default: 0.05, step: 0.001 },
    phi: { hardMin: 0, hardMax: Infinity, recommendedMin: 100, recommendedMax: 200, default: 200, step: 5 },
    tau: { hardMin: 0, hardMax: 1, recommendedMin: 0.97, recommendedMax: 1.0, default: 0.99, step: 0.005 },
    s: { hardMin: 0, hardMax: Infinity, recommendedMin: 0.5, recommendedMax: 5.0, default: 2.0, step: 0.1 },
    noiseScaleC: { hardMin: 0, hardMax: Infinity, recommendedMin: 0, recommendedMax: 0.05, default: 0.01, step: 0.005 },
};
/** HDoG shares ADoG's parameter regime (its screentone passes are ADoG). */
const HDOG_PARAM_RANGES = {
    ...ADOG_PARAM_RANGES,
    adogSecondaryScaleFactor: { hardMin: 1.0, hardMax: Infinity, recommendedMin: 2.0, recommendedMax: 6.0, default: 4.0, step: 0.25 },
};
/**
 * Default DoG configuration values
 * Based on paper's recommendations and Appendix A parameter ranges
 */
const DEFAULT_DOG_CONFIG = {
    sigma: DOG_PARAM_RANGES.sigma.default,
    k: DOG_PARAM_RANGES.k.default,
    p: DOG_PARAM_RANGES.p.default, // Strong edge emphasis suitable for most styles
    epsilon: DOG_PARAM_RANGES.epsilon.default, // Mid-tone threshold (normalized 0-1)
    phi: DOG_PARAM_RANGES.phi.default, // Moderately sharp 
    thresholdStrategy: new SoftThresholdStrategy()
};
/**
 * Default values for FDoGConfig.confidenceWeighting's sub-options, used
 * once the caller opts in by providing the (possibly empty) object.
 * Not sourced from FDOG_PARAM_RANGES -- like HDoGConfig's
 * adogSecondaryScaleFactor, these are structural/behavioral toggles
 * rather than paper-tabulated sigma/p/epsilon/phi knobs.
 */
const DEFAULT_CONFIDENCE_WEIGHTING_CONFIG = {
    epsilonMargin: FDOG_CONFIDENCE_WEIGHT_PARAM_RANGES.epsilonMargin.default,
    sigmaMBlend: true,
    sigmaABlend: true,
    pByMagnitude: true,
};
const CONFIDENCE_WEIGHTING_DISABLED = {
    epsilonMargin: 0,
    sigmaMBlend: false,
    sigmaABlend: false,
    pByMagnitude: false,
};
/**
 * Resolve FDoGConfig.confidenceWeighting into a ResolvedConfidenceWeighting.
 * `undefined` (opted out) resolves to CONFIDENCE_WEIGHTING_DISABLED; any
 * object (even `{}`) merges over DEFAULT_CONFIDENCE_WEIGHTING_CONFIG
 * following the same override convention used
 * everywhere else in this file (`{ ...DEFAULT_X, ...overrides }`).
 */
function resolveConfidenceWeighting(config) {
    if (!config)
        return CONFIDENCE_WEIGHTING_DISABLED;
    return { ...DEFAULT_CONFIDENCE_WEIGHTING_CONFIG, ...config };
}
/**
 * Default FDoG configuration values
 * Based on Table A.1 in the paper
 */
const DEFAULT_FDOG_CONFIG = {
    ...DEFAULT_DOG_CONFIG,
    sigmaC: FDOG_PARAM_RANGES.sigmaC.default, // Structure tensor smoothing
    sigmaM: FDOG_PARAM_RANGES.sigmaM.default, // Flow-aligned smoothing
    sigmaA: FDOG_PARAM_RANGES.sigmaA.default, // Anti-aliasing,
    thresholdStrategy: new HardThresholdStrategy()
    // confidenceWeighting intentionally omitted: undefined = off by
    // default, so existing callers' output doesn't silently change (see
    // FDoGConfig.confidenceWeighting's doc comment).
};
/**
 * Default ADoG configuration values
 * Based on Section 3.2 of "Gaussian Image Binarization"
 * (σc = 1.0, σs = 1.6σc, τ = 0.99, s = 2.0, noise c = 0.01)
 */
const DEFAULT_ADOG_CONFIG = {
    ...DEFAULT_DOG_CONFIG,
    sigma: ADOG_PARAM_RANGES.sigma.default,
    k: ADOG_PARAM_RANGES.k.default,
    epsilon: ADOG_PARAM_RANGES.epsilon.default, // Low: dark screentone primitives on white
    phi: ADOG_PARAM_RANGES.phi.default, // High: hard-threshold / near step function
    tau: ADOG_PARAM_RANGES.tau.default,
    s: ADOG_PARAM_RANGES.s.default,
    noiseScaleC: ADOG_PARAM_RANGES.noiseScaleC.default,
    kernelSizeMultiplier: XDOG_PARAM_RANGES.kernelSizeMultiplier.default,
    thresholdStrategy: new HardThresholdStrategy(),
};
/**
 * Default HDoG configuration values
 * s' defaults to 4s per the paper's empirical setting (Eq. 9)
 */
const DEFAULT_HDOG_CONFIG = {
    fdog: {},
    adog: {},
    adogSecondaryScaleFactor: 4,
};
/**
 * Preset configurations for common styles from the paper
 */
const STYLE_PRESETS = {
    /**
     * Pencil shading style (Figure 1b, Section 5.2)
     * High-frequency detail resembling graphite on paper
     */
    pencilShading: {
        sigma: 0.4,
        k: 1.6,
        p: 20,
        epsilon: 0.5,
        phi: 0.01, // Very soft threshold for gradual tones
    },
    /**
     * Pastel style (Figure 18b, Section 5.2)
     * Intermediate edge width with flow turbulence
     */
    pastel: {
        sigma: 2.0,
        k: 1.6,
        p: 40,
        epsilon: 1.0, // High threshold (mostly white)
        phi: 0.01,
    },
    /**
     * Charcoal style (Figure 18c, Section 5.2)
     * Broad strokes from large spatial support
     */
    charcoal: {
        sigma: 7.0,
        k: 1.6,
        p: 70,
        epsilon: 0.8,
        phi: 0.01,
    },
    /**
     * Thresholding / line art (Section 4.1)
     * Clean black and white edges
     */
    threshold: {
        sigma: 1.4,
        k: 1.6,
        p: 20,
        epsilon: 0.78,
        phi: 100, // Very sharp threshold (near step function)
    },
    /**
     * Woodcut style (Section 4.2, Figure 15)
     * Aggressive flow distortion with extreme edge emphasis
     */
    woodcut: {
        sigma: 0.8,
        k: 1.6,
        p: 120, // Extreme edge emphasis
        epsilon: 0.73,
        phi: 100, // Hard threshold
    },
};
/**
 * Preset FDoG configurations including flow parameters
 */
const FDOG_STYLE_PRESETS = {
    /**
     * Standard FDoG for coherent line drawing (Figure 2g)
     */
    standard: {
        ...STYLE_PRESETS.threshold,
        sigmaC: 2.28,
        sigmaM: 4.4,
        sigmaA: 1.0,
    },
    /**
     * Pastel with flow (Figure 18b)
     */
    pastel: {
        ...STYLE_PRESETS.pastel,
        sigmaC: 0.1, // Minimal structure tensor smoothing
        sigmaM: 20, // Large flow smoothing for turbulence
        sigmaA: 7.2,
    },
    /**
     * Woodcut with aggressive flow (Figure 15)
     */
    woodcut: {
        ...STYLE_PRESETS.woodcut,
        sigmaC: 5.84,
        sigmaM: 3.2,
        sigmaA: 0.75,
    },
};
/**
 * Preset ADoG configurations
 * (No presets given directly in the paper's tables beyond the defaults
 * above; add named presets here as you tune them, e.g. denser/lighter
 * screentone variants.)
 */
const ADOG_STYLE_PRESETS = {
    standard: {
        ...DEFAULT_ADOG_CONFIG,
    },
};
const HDOG_STYLE_PRESETS = {
    /**
     * Paper defaults (Sec. 3.1–3.3): σc=1.0, k=1.6 (σs=1.6σc), σm=3.0,
     * σa≈1.0 (not explicitly stated as a default in the paper's FDoG
     * section, so this uses a light anti-aliasing value), τ=0.99, s=2.0,
     * noiseScaleC=0.01, s'=4s. This is the closest match to Figs. 13–14.
     */
    default: {
        fdog: DEFAULT_FDOG_CONFIG,
        adog: DEFAULT_ADOG_CONFIG,
        adogSecondaryScaleFactor: 4,
    }
};

/**
 * Core types for XDoG/FDoG/ADoG/HDoG line drawing implementation
 *
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 * and: "Gaussian Image Binarization" by Kang & Stamoulis (2021)
 */
const DEFAULT_ISOTROPIC_BLUR_CONFIG = {
    sigma: 1,
    kernelSizeMultiplier: 6,
    maxKernelSize: 63,
};
const DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG = {
    kernelSizeMultiplier: 6,
    stepSize: 1.0,
};
// Default config values (mirrors the CPU implementation in cpu.ts)
const DEFAULT_BILATERAL_CONFIG$3 = {
    sigmaSpatial: 3,
    sigmaRange: 0.1,
    radiusMultiplier: 2,
};
const DEFAULT_MEDIAN_CONFIG$3 = {
    radius: 2,
};
const DEFAULT_KUWAHARA_CONFIG$3 = {
    radius: 3,
};
const DEFAULT_CONTRAST_ENHANCEMENT_CONFIG = {
    blackPoint: 0.01,
    whitePoint: 0.99
};
const DEFAULT_QUANTIZER_CONFIG = {
    levels: 8
};
const DEFAULT_GAUSSIAN_CONFIG = {
    sigma: 1.0
};
/**
 * Default ETF configuration values
 */
const DEFAULT_ETF_CONFIG = {
    iterations: 3,
    kernelSize: 5,
};

/**
 * Difference of Gaussians processor
 *
 * This is the core processor that can be used for both XDoG (with IsotropicBlur)
 * and FDoG (with FlowGuidedBlur).
 *
 * Implements the reparameterized formulation from Section 2.5 of:
 * "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemoller et al. (2012)
 */
/**
 * Difference of Gaussians processor
 *
 * Uses the reparameterized formulation (Equation 7):
 * S_sigma,k,p(x) = G_sigma(x) + p x D_sigma,k(x) = (1 + p) x G_sigma(x) - p x G_ksigma(x)
 *
 * This is equivalent to unsharp masking of the blurred image, which
 * decouples edge sharpening strength (p) from threshold parameters.
 *
 * The blur strategy can be swapped to get different effects:
 * - IsotropicBlur: Standard XDoG with uniform blur
 * - FlowGuidedBlur: FDoG with edge-coherent blur
 * - GradientAlignedBlur: Blur across edges only
 */
class DoGProcessor {
    config;
    blurStrategy;
    thresholdStrategy;
    constructor(blurStrategy, config = {}) {
        this.blurStrategy = blurStrategy;
        this.config = { ...DEFAULT_DOG_CONFIG, ...config };
        this.thresholdStrategy = config.thresholdStrategy ?? new SoftThresholdStrategy();
    }
    dispose() {
        this.blurStrategy.dispose();
    }
    /**
     * Process an image through the DoG pipeline
     *
     * Pipeline:
     * 1. Apply two Gaussian blurs with different sigma values
     * 2. Compute sharpened image using Equation 7
     * 3. Apply soft thresholding using Equation 5
     *
     * @param input Grayscale input image (values in 0-1 range)
     * @param overrides Optional parameter overrides for this call
     * @returns Processed image with edges detected and stylized
     */
    async process(input, overrides = {}) {
        const params = { ...this.config, ...overrides };
        // Step 1: Apply two Gaussian blurs with different sigma values
        // G_sigma * I and G_ksigma * I
        const [blur1, blur2] = await Promise.all([
            this.blurStrategy.blur(input, params.sigma),
            this.blurStrategy.blur(input, params.sigma * params.k)
        ]);
        // Step 2: Compute sharpened image using Equation 7
        // S = (1 + p) * G_sigma * I - p * G_ksigma * I
        const sharpened = this.computeSharpening(blur1, blur2, params.p);
        // Step 3: Apply soft thresholding using Equation 5
        const output = this.applyThreshold(sharpened, params.epsilon, params.phi);
        return output;
    }
    /**
     * Process without thresholding - returns the sharpened image
     * Useful for debugging or custom post-processing
     */
    async processNoThreshold(input, overrides = {}) {
        const params = { ...this.config, ...overrides };
        const [blur1, blur2] = await Promise.all([
            this.blurStrategy.blur(input, params.sigma),
            this.blurStrategy.blur(input, params.sigma * params.k)
        ]);
        return this.computeSharpening(blur1, blur2, params.p);
    }
    /**
     * Get the raw DoG response (without sharpening or thresholding)
     * Useful for visualization and debugging
     */
    async processRawDoG(input, overrides = {}) {
        const params = { ...this.config, ...overrides };
        const [blur1, blur2] = await Promise.all([
            this.blurStrategy.blur(input, params.sigma),
            this.blurStrategy.blur(input, params.sigma * params.k)
        ]);
        return this.computeDoG(blur1, blur2);
    }
    /**
     * Process and return all intermediate results in a single pass
     *
     * This is more efficient than calling process(), processNoThreshold(), and
     * processRawDoG() separately as it only performs the blur operations once.
     *
     * @param input Grayscale input image (values in 0-1 range)
     * @param overrides Optional parameter overrides for this call
     * @returns Object containing result, sharpened, and rawDoG images
     */
    async processDetailed(input, overrides = {}) {
        const params = { ...this.config, ...overrides };
        // Step 1: Apply two Gaussian blurs (only once!)
        const [blur1, blur2] = await Promise.all([
            this.blurStrategy.blur(input, params.sigma),
            this.blurStrategy.blur(input, params.sigma * params.k)
        ]);
        // Step 2: Compute raw DoG
        const rawDoG = this.computeDoG(blur1, blur2);
        // Step 3: Compute sharpened image
        const sharpened = this.computeSharpening(blur1, blur2, params.p);
        // Step 4: Apply thresholding
        const result = this.applyThreshold(sharpened, params.epsilon, params.phi);
        return { result, sharpened, rawDoG };
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Update configuration
     */
    setConfig(config) {
        this.config = { ...this.config, ...config };
    }
    /**
     * Replace blur strategy
     */
    setBlurStrategy(strategy) {
        this.blurStrategy = strategy;
    }
    /**
     * Compute raw Difference of Gaussians: D(x) = G_sigma(x) - G_ksigma(x)
     * This is the standard DoG without any weighting
     */
    computeDoG(blur1, blur2) {
        const output = createChannelImage$1(blur1.width, blur1.height);
        const size = blur1.width * blur1.height;
        for (let i = 0; i < size; i++) {
            output.data[i] = blur1.data[i] - blur2.data[i];
        }
        return output;
    }
    /**
     * Compute sharpened image using Equation 7 from the paper:
     * S_sigma,k,p(x) = G_sigma(x) + p x D_sigma,k(x) = (1 + p) x G_sigma(x) - p x G_ksigma(x)
     *
     * This can be understood as unsharp masking of the blurred image.
     * The parameter p controls the edge sharpening strength independently
     * of the threshold parameters.
     *
     * @param blur1 G_sigma * I (smaller blur)
     * @param blur2 G_ksigma * I (larger blur)
     * @param p Sharpening strength (p ≈ 20 typical, p ≈ 100 for woodcut)
     */
    computeSharpening(blur1, blur2, p) {
        const output = createChannelImage$1(blur1.width, blur1.height);
        const size = blur1.width * blur1.height;
        for (let i = 0; i < size; i++) {
            const pValue = at(p, i);
            output.data[i] = (1 + pValue) * blur1.data[i] - pValue * blur2.data[i];
        }
        return output;
    }
    /**
     * Apply thresholding using the configured strategy
     * This creates the characteristic XDoG stylization:
     * - Values above ε become white (1)
     * - Values below ε get soft-thresholded with tanh
     * - φ controls the sharpness of the transition
     *
     * @param sharpened Sharpened image from computeSharpening
     * @param epsilon Threshold value (typically around 0.5-0.8 for normalized images)
     * @param phi Threshold sharpness (0.01 = soft, 100 = near step function)
     */
    applyThreshold(sharpened, epsilon, phi) {
        const config = { epsilon, phi };
        return this.thresholdStrategy.threshold(sharpened, config);
    }
}
/**
 * Alternative thresholding modes that can be used for different effects
 * These can be applied to the sharpened image manually for custom styles
 */
const ThresholdModes = {
    /**
     * Hard black and white threshold (step function)
     * Equivalent to φ → ∞ in the soft threshold
     */
    hard: (value, epsilon) => {
        return value >= epsilon ? 1.0 : 0.0;
    },
    /**
     * Soft threshold (default XDoG style, Equation 5)
     */
    soft: (value, epsilon, phi) => {
        if (value >= epsilon)
            return 1.0;
        return 1.0 + Math.tanh(phi * (value - epsilon));
    },
    /**
     * Three-tone (white, gray, black) for sketch effect
     * Creates a posterized look with three distinct values
     */
    threeTone: (value, epsilon, midPoint = 0.0) => {
        if (value >= epsilon)
            return 1.0;
        if (value >= midPoint)
            return 0.5;
        return 0.0;
    },
    /**
     * Multi-tone quantization
     * Quantizes to n discrete levels
     */
    multiTone: (value, levels) => {
        const step = 1.0 / (levels - 1);
        return Math.round(Math.max(0, Math.min(1, value)) / step) * step;
    },
    /**
     * Continuous (no thresholding) - useful for seeing raw sharpened output
     * Maps the range to 0-1 for visualization
     */
    continuous: (value) => {
        return Math.max(0, Math.min(1, value * 0.5 + 0.5));
    },
    /**
     * Smooth curve approximating three-value quantization
     * Used for Figure 7(c) in the paper
     */
    smoothThreeTone: (value, epsilon, phi) => {
        // Creates two smooth steps instead of one
        const upper = 1.0 + Math.tanh(phi * (value - epsilon));
        const lower = 0.5 * (1.0 + Math.tanh(phi * (value - epsilon * 0.5)));
        return Math.max(0, Math.min(1, lower * 0.5 + upper * 0.5));
    },
};
/**
 * Apply a custom threshold function to a grayscale image
 */
function applyCustomThreshold(input, thresholdFn) {
    const output = createChannelImage$1(input.width, input.height);
    const size = input.width * input.height;
    for (let i = 0; i < size; i++) {
        output.data[i] = thresholdFn(input.data[i]);
    }
    return output;
}

/**
 * Shared machinery for "pick the best supported backend, fall back
 * gracefully if it fails later" filters.
 */
class ResilientEdgeAwareFilter {
    candidates;
    config;
    failedBackends = new Set();
    instance;
    currentCtor;
    /**
     * Subclasses resolve their instance via `resolve()` *before* calling
     * this (in their own async static `create()`), then hand the result in
     * here. The constructor itself stays synchronous, as constructors must.
     */
    constructor(candidates, resolved, config) {
        this.candidates = candidates;
        this.config = config;
        this.instance = resolved.instance;
        this.currentCtor = resolved.ctor;
    }
    /**
     * Try each candidate in order, skipping unsupported ones. If a
     * candidate reports supported but throws on construction anyway
     * (isSupported() lied), move on to the next.
     */
    static async resolve(candidates, config) {
        for (const Ctor of candidates) {
            if (await Ctor.isSupported()) {
                try {
                    return { instance: new Ctor(config), ctor: Ctor };
                }
                catch {
                    continue;
                }
            }
        }
        throw new Error('No supported filter implementation available');
    }
    get backend() {
        return this.instance.backend;
    }
    dispose() {
        this.instance.dispose();
    }
    async apply(input, options) {
        let current = this.instance;
        while (true) {
            try {
                console.log(`${this.constructor.name}: Running ${current.backend}`);
                return await current.apply(input, options);
            }
            catch (err) {
                console.warn(`${this.constructor.name}: [${this.currentCtor.name}] process() failed, attempting fallback:`, err);
                const fallback = await this.demoteAndFindNext();
                if (!fallback)
                    throw err;
                current = fallback;
            }
        }
    }
    async demoteAndFindNext() {
        this.failedBackends.add(this.currentCtor);
        this.instance.dispose();
        for (const Ctor of this.candidates) {
            if (this.failedBackends.has(Ctor))
                continue;
            if (await Ctor.isSupported()) {
                try {
                    this.instance = new Ctor(this.config);
                    this.currentCtor = Ctor;
                    console.warn(`Falling back to ${Ctor.name}`);
                    return this.instance;
                }
                catch (err) {
                    console.warn(`[${Ctor.name}] construction failed despite isSupported():`, err);
                    this.failedBackends.add(Ctor);
                }
            }
        }
        return null;
    }
}

class BaseCPUStrategy {
    backend = 'cpu';
    dispose() { }
    static isSupported() { return Promise.resolve(true); }
    static getUnsupportedReason() { return undefined; }
}
class BaseWebGLStrategy {
    backend = 'webgl';
    dispose() { } // was missing here — Preprocessor/ETFComputer both require Disposable
    static isSupported() {
        return Promise.resolve(isWebGLComputeSupported());
    }
    /**
     * Get reason if WebGL2 is not supported.
     *
     * Declared to allow an async return (per StrategyCtor in interfaces/base.ts)
     * even though this base implementation itself is synchronous, so that
     * subclasses that need to probe the shared/module-level GL context
     * asynchronously can override it without a static-side type conflict.
     */
    static getUnsupportedReason() {
        if (typeof OffscreenCanvas === 'undefined' && typeof document === 'undefined') {
            return 'Neither OffscreenCanvas nor document is available';
        }
        try {
            if (typeof OffscreenCanvas !== 'undefined') {
                const canvas = new OffscreenCanvas(1, 1);
                if (!canvas.getContext('webgl2')) {
                    return 'WebGL2 context creation failed on OffscreenCanvas';
                }
            }
            else {
                const canvas = document.createElement('canvas');
                if (!canvas.getContext('webgl2')) {
                    return 'WebGL2 context creation failed';
                }
            }
        }
        catch (e) {
            return `WebGL2 initialization error: ${e}`;
        }
        return undefined;
    }
    /**
     * WebGL errors are synchronous — no scopes, just drain-then-check.
     * See discussion in webgl.ts for why this is needed.
     */
    runGuarded(gl, fn) {
        while (gl.getError() !== gl.NO_ERROR) { } // drain stale error
        const result = fn();
        const error = gl.getError();
        if (error !== gl.NO_ERROR) {
            throw new Error(`WebGL error: code ${error}`);
        }
        if (gl.isContextLost()) {
            throw new Error('WebGL context was lost during this operation.');
        }
        return result;
    }
}
class BaseWebGPUStrategy {
    backend = 'webgpu';
    dispose() { } // was missing here too
    static cachedAdapter = null;
    static cachedDevice = null;
    static devicePromise = null;
    static adapterInfo = null;
    static isSoftwareRenderer = false;
    /**
     * Check if WebGPU is supported (sync check - just API availability)
     */
    static isSupported() {
        const isSupported = typeof navigator !== 'undefined' && 'gpu' in navigator;
        return Promise.resolve(isSupported);
    }
    /**
     * Get reason if WebGPU is not supported.
     *
     * Declared to allow an async return (per StrategyCtor in interfaces/base.ts)
     * even though this base implementation itself is synchronous, so that
     * subclasses that need to request an adapter to confirm availability
     * can override it without a static-side type conflict.
     */
    static getUnsupportedReason() {
        if (typeof navigator === 'undefined') {
            return 'navigator is not available (not in browser environment)';
        }
        if (!('gpu' in navigator)) {
            return 'WebGPU is not supported in this browser';
        }
        return undefined;
    }
    /**
     * Check if the adapter is a software/fallback renderer (call after getWebGPUDevice)
     */
    static isFallbackAdapter() {
        return this.isSoftwareRenderer;
    }
    /**
     * Get adapter info (call after getWebGPUDevice)
     */
    static getAdapterInfo() {
        return this.adapterInfo;
    }
    /**
     * Async check if WebGPU is actually usable with hardware acceleration
     * Returns false for software renderers like SwiftShader
     */
    static async isAvailable(allowSoftware = false) {
        const device = await BaseWebGPUStrategy.getWebGPUDevice();
        if (!device)
            return false;
        if (!allowSoftware && this.isSoftwareRenderer)
            return false;
        return true;
    }
    /**
     * Detect if adapter is a software renderer
     */
    static detectSoftwareRenderer(adapter, info) {
        // Most reliable check
        if (adapter.isFallbackAdapter) {
            return true;
        }
        // Check device type
        if (info.type === 'CPU') {
            return true;
        }
        // Check for known software renderer signatures
        const description = (info.description || '').toLowerCase();
        const vendor = (info.vendor || '').toLowerCase();
        const architecture = (info.architecture || '').toLowerCase();
        const softwareIndicators = [
            'swiftshader',
            'llvmpipe',
            'softpipe',
            'microsoft basic render',
            'software',
        ];
        return softwareIndicators.some((indicator) => description.includes(indicator) ||
            vendor.includes(indicator) ||
            architecture.includes(indicator));
    }
    /**
     * Get or create WebGPU device (shared)
     */
    static async getWebGPUDevice() {
        if (this.cachedDevice)
            return this.cachedDevice;
        if (this.devicePromise)
            return this.devicePromise;
        this.devicePromise = (async () => {
            try {
                if (!navigator.gpu)
                    return null;
                this.cachedAdapter = await navigator.gpu.requestAdapter();
                if (!this.cachedAdapter)
                    return null;
                // Get adapter info and detect software renderer
                this.adapterInfo = await this.cachedAdapter.info;
                this.isSoftwareRenderer = this.detectSoftwareRenderer(this.cachedAdapter, this.adapterInfo);
                this.cachedDevice = await this.cachedAdapter.requestDevice();
                // Handle device loss
                this.cachedDevice.lost.then(() => {
                    this.cachedDevice = null;
                    this.cachedAdapter = null;
                    this.adapterInfo = null;
                    this.devicePromise = null;
                    this.isSoftwareRenderer = false;
                });
                return this.cachedDevice;
            }
            catch {
                return null;
            }
        })();
        return this.devicePromise;
    }
    /**
     * WebGPU errors are async (error scopes). See discussion in
     * webgpu.ts for why try/catch alone misses these.
     */
    async runGuarded(device, fn) {
        device.pushErrorScope('validation');
        device.pushErrorScope('out-of-memory');
        const cleanup = async () => {
            try {
                const oomError = await device.popErrorScope();
                const validationError = await device.popErrorScope();
                if (validationError)
                    throw new Error(`WebGPU validation error: ${validationError.message}`);
                if (oomError)
                    throw new Error(`WebGPU out-of-memory error: ${oomError.message}`);
            }
            catch {
                // Device was likely lost mid-scope; popErrorScope can reject in that case.
                // Swallow here — device.lost is the source of truth for that condition.
            }
        };
        try {
            const result = await Promise.race([
                fn(),
                device.lost.then((info) => {
                    throw new Error(`WebGPU device lost during operation: ${info.message}`);
                }),
            ]);
            await cleanup();
            return result;
        }
        catch (err) {
            await cleanup();
            throw err;
        }
    }
}

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/shaders/webgl/bilateral.glsl
// Regenerate with `npm run build:shaders`.
const source$R = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform float u_sigmaSpatial2;
uniform float u_sigmaRange2;
uniform int u_radius;

void main() {
  float centerValue = texture(u_image, v_texCoord).r;
  
  float sum = 0.0;
  float weightSum = 0.0;
  
  for (int dy = -u_radius; dy <= u_radius; dy++) {
    for (int dx = -u_radius; dx <= u_radius; dx++) {
      vec2 offset = vec2(float(dx), float(dy)) * u_texelSize;
      float neighborValue = texture(u_image, v_texCoord + offset).r;
      
      // Spatial weight
      float dist2 = float(dx * dx + dy * dy);
      float spatialWeight = exp(-dist2 / u_sigmaSpatial2);
      
      // Range weight
      float diff = neighborValue - centerValue;
      float rangeWeight = exp(-(diff * diff) / u_sigmaRange2);
      
      float weight = spatialWeight * rangeWeight;
      sum += neighborValue * weight;
      weightSum += weight;
    }
  }
  
  float result = weightSum > 0.0 ? sum / weightSum : centerValue;
  fragColor = vec4(result, 0.0, 0.0, 1.0);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/shaders/webgl/contrast.glsl
// Regenerate with `npm run build:shaders`.
const source$Q = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform float u_minVal;
uniform float u_maxVal;

void main() {
  float value = texture(u_image, v_texCoord).r;
  float range = u_maxVal - u_minVal;
  
  float result = range > 0.01 
    ? clamp((value - u_minVal) / range, 0.0, 1.0)
    : value;
    
  fragColor = vec4(result, 0.0, 0.0, 1.0);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/shaders/webgl/guassian-horizontal.glsl
// Regenerate with `npm run build:shaders`.
const source$P = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform float u_texelSizeX;
uniform int u_radius;
uniform float u_sigma2;

void main() {
  float sum = 0.0;
  float weightSum = 0.0;
  
  for (int dx = -u_radius; dx <= u_radius; dx++) {
    float offset = float(dx) * u_texelSizeX;
    float value = texture(u_image, v_texCoord + vec2(offset, 0.0)).r;
    
    float weight = exp(-float(dx * dx) / u_sigma2);
    sum += value * weight;
    weightSum += weight;
  }
  
  fragColor = vec4(sum / weightSum, 0.0, 0.0, 1.0);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/shaders/webgl/guassian-vertical.glsl
// Regenerate with `npm run build:shaders`.
const source$O = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform float u_texelSizeY;
uniform int u_radius;
uniform float u_sigma2;

void main() {
  float sum = 0.0;
  float weightSum = 0.0;
  
  for (int dy = -u_radius; dy <= u_radius; dy++) {
    float offset = float(dy) * u_texelSizeY;
    float value = texture(u_image, v_texCoord + vec2(0.0, offset)).r;
    
    float weight = exp(-float(dy * dy) / u_sigma2);
    sum += value * weight;
    weightSum += weight;
  }
  
  fragColor = vec4(sum / weightSum, 0.0, 0.0, 1.0);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/shaders/webgl/kuwahara.glsl
// Regenerate with `npm run build:shaders`.
const source$N = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform int u_radius;

// Calculate mean and variance for a quadrant
vec2 quadrantStats(vec2 center, int startX, int endX, int startY, int endY) {
  float sum = 0.0;
  float sumSq = 0.0;
  float count = 0.0;
  
  for (int dy = startY; dy <= endY; dy++) {
    for (int dx = startX; dx <= endX; dx++) {
      vec2 offset = vec2(float(dx), float(dy)) * u_texelSize;
      float val = texture(u_image, center + offset).r;
      sum += val;
      sumSq += val * val;
      count += 1.0;
    }
  }
  
  float mean = sum / count;
  float variance = (sumSq / count) - (mean * mean);
  
  return vec2(mean, variance);
}

void main() {
  int r = u_radius;
  
  // Four quadrants: top-left, top-right, bottom-left, bottom-right
  vec2 q0 = quadrantStats(v_texCoord, -r, 0, -r, 0);
  vec2 q1 = quadrantStats(v_texCoord, 0, r, -r, 0);
  vec2 q2 = quadrantStats(v_texCoord, -r, 0, 0, r);
  vec2 q3 = quadrantStats(v_texCoord, 0, r, 0, r);
  
  // Find quadrant with minimum variance
  float minVar = q0.y;
  float result = q0.x;
  
  if (q1.y < minVar) { minVar = q1.y; result = q1.x; }
  if (q2.y < minVar) { minVar = q2.y; result = q2.x; }
  if (q3.y < minVar) { result = q3.x; }
  
  fragColor = vec4(result, 0.0, 0.0, 1.0);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/shaders/webgl/median-small.glsl
// Regenerate with `npm run build:shaders`.
const source$M = `// For small radius, use direct sorting approach (more accurate)
#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform int u_radius;

// Partial sort network for finding median of small kernels
// This is exact for radius 1-2 (3x3 to 5x5 kernels)

void swap(inout float a, inout float b) {
  float t = min(a, b);
  b = max(a, b);
  a = t;
}

void main() {
  // Collect all values
  float values[25]; // Max 5x5
  int count = 0;
  
  for (int dy = -u_radius; dy <= u_radius; dy++) {
    for (int dx = -u_radius; dx <= u_radius; dx++) {
      vec2 offset = vec2(float(dx), float(dy)) * u_texelSize;
      values[count] = texture(u_image, v_texCoord + offset).r;
      count++;
    }
  }
  
  // Partial bubble sort to find median
  int medianIdx = count / 2;
  
  for (int i = 0; i <= medianIdx; i++) {
    for (int j = i + 1; j < count; j++) {
      swap(values[i], values[j]);
    }
  }
  
  fragColor = vec4(values[medianIdx], 0.0, 0.0, 1.0);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/shaders/webgl/median.glsl
// Regenerate with `npm run build:shaders`.
const source$L = `// True median requires sorting which isn't efficient in shaders.
// We use a weighted percentile approximation that's very close to median.
#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform int u_radius;

// Histogram-based median approximation
// We use 32 bins for speed while maintaining accuracy
#define NUM_BINS 32

void main() {
  float bins[NUM_BINS];
  for (int i = 0; i < NUM_BINS; i++) bins[i] = 0.0;
  
  float totalWeight = 0.0;
  int kernelSize = (2 * u_radius + 1) * (2 * u_radius + 1);
  
  // Build histogram
  for (int dy = -u_radius; dy <= u_radius; dy++) {
    for (int dx = -u_radius; dx <= u_radius; dx++) {
      vec2 offset = vec2(float(dx), float(dy)) * u_texelSize;
      float value = texture(u_image, v_texCoord + offset).r;
      
      // Map value to bin
      int binIdx = int(clamp(value * float(NUM_BINS - 1), 0.0, float(NUM_BINS - 1)));
      bins[binIdx] += 1.0;
      totalWeight += 1.0;
    }
  }
  
  // Find median (50th percentile)
  float targetWeight = totalWeight * 0.5;
  float cumWeight = 0.0;
  float median = 0.5;
  
  for (int i = 0; i < NUM_BINS; i++) {
    cumWeight += bins[i];
    if (cumWeight >= targetWeight) {
      median = (float(i) + 0.5) / float(NUM_BINS);
      break;
    }
  }
  
  fragColor = vec4(median, 0.0, 0.0, 1.0);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/shaders/webgl/quantize.glsl
// Regenerate with `npm run build:shaders`.
const source$K = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform float u_levels;

void main() {
  float value = texture(u_image, v_texCoord).r;
  float step = 1.0 / (u_levels - 1.0);
  float result = floor(value / step + 0.5) * step;
  fragColor = vec4(clamp(result, 0.0, 1.0), 0.0, 0.0, 1.0);
}`;

/**
 * WebGL-Accelerated Preprocessing Module for XDoG/FDoG
 *
 * High-performance GPU implementations of image preprocessing filters.
 * Achieves 50-100x speedup over CPU implementations for large images.
 */
// ============================================================================
// WebGL Context Management
// ============================================================================
let gl$2 = null;
let canvas$2 = null;
// Shader program cache
const programCache$2 = new Map();
// Reusable geometry buffers
let quadVAO$2 = null;
/**
 * Check if running in a WebWorker context
 */
function isWorkerContext$2() {
    return typeof document === 'undefined';
}
/**
 * Initialize or get WebGL context
 */
function getGL$2() {
    if (gl$2)
        return gl$2;
    try {
        let glCanvas;
        // Use OffscreenCanvas in WebWorker, HTMLCanvasElement in main thread
        if (isWorkerContext$2()) {
            glCanvas = new OffscreenCanvas(1, 1);
        }
        else {
            glCanvas = document.createElement('canvas');
        }
        glCanvas.width = 1;
        glCanvas.height = 1;
        gl$2 = glCanvas.getContext('webgl2', {
            alpha: false,
            antialias: false,
            depth: false,
            stencil: false,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: false,
        });
        if (!gl$2) {
            console.warn('WebGL 2.0 not available');
            return null;
        }
        // Enable required extensions for float textures
        const ext1 = gl$2.getExtension('EXT_color_buffer_float');
        if (!ext1) {
            console.warn('EXT_color_buffer_float not available, some features may be limited');
        }
        canvas$2 = glCanvas;
        // Setup reusable quad geometry
        setupQuadGeometry$2();
        return gl$2;
    }
    catch (err) {
        console.error('WebGL initialization failed:', err);
        return null;
    }
}
/**
 * Setup fullscreen quad VAO (reused for all render passes)
 */
function setupQuadGeometry$2() {
    if (!gl$2)
        return;
    quadVAO$2 = gl$2.createVertexArray();
    gl$2.bindVertexArray(quadVAO$2);
    // Positions: fullscreen quad in clip space
    const positions = new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        1, 1,
    ]);
    // Texture coordinates
    const texCoords = new Float32Array([
        0, 0,
        1, 0,
        0, 1,
        1, 1,
    ]);
    const posBuffer = gl$2.createBuffer();
    gl$2.bindBuffer(gl$2.ARRAY_BUFFER, posBuffer);
    gl$2.bufferData(gl$2.ARRAY_BUFFER, positions, gl$2.STATIC_DRAW);
    gl$2.enableVertexAttribArray(0);
    gl$2.vertexAttribPointer(0, 2, gl$2.FLOAT, false, 0, 0);
    const texBuffer = gl$2.createBuffer();
    gl$2.bindBuffer(gl$2.ARRAY_BUFFER, texBuffer);
    gl$2.bufferData(gl$2.ARRAY_BUFFER, texCoords, gl$2.STATIC_DRAW);
    gl$2.enableVertexAttribArray(1);
    gl$2.vertexAttribPointer(1, 2, gl$2.FLOAT, false, 0, 0);
    gl$2.bindVertexArray(null);
}
// ============================================================================
// Shader Compilation Utilities
// ============================================================================
const VERTEX_SHADER$2 = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;
out vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;
function compileShader$4(source, type) {
    if (!gl$2)
        return null;
    const shader = gl$2.createShader(type);
    if (!shader)
        return null;
    gl$2.shaderSource(shader, source);
    gl$2.compileShader(shader);
    if (!gl$2.getShaderParameter(shader, gl$2.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl$2.getShaderInfoLog(shader));
        gl$2.deleteShader(shader);
        return null;
    }
    return shader;
}
function createProgram$5(fragmentSource, cacheKey) {
    if (!gl$2)
        return null;
    // Check cache first
    const cached = programCache$2.get(cacheKey);
    if (cached)
        return cached;
    const vertShader = compileShader$4(VERTEX_SHADER$2, gl$2.VERTEX_SHADER);
    const fragShader = compileShader$4(fragmentSource, gl$2.FRAGMENT_SHADER);
    if (!vertShader || !fragShader)
        return null;
    const program = gl$2.createProgram();
    if (!program)
        return null;
    gl$2.attachShader(program, vertShader);
    gl$2.attachShader(program, fragShader);
    gl$2.linkProgram(program);
    if (!gl$2.getProgramParameter(program, gl$2.LINK_STATUS)) {
        console.error('Program link error:', gl$2.getProgramInfoLog(program));
        gl$2.deleteProgram(program);
        return null;
    }
    // Cleanup shaders (they're now part of the program)
    gl$2.deleteShader(vertShader);
    gl$2.deleteShader(fragShader);
    // Cache the program
    programCache$2.set(cacheKey, program);
    return program;
}
// ============================================================================
// Texture and Framebuffer Utilities
// ============================================================================
function createInputTexture$2(data, width, height) {
    if (!gl$2)
        return null;
    const texture = gl$2.createTexture();
    gl$2.bindTexture(gl$2.TEXTURE_2D, texture);
    // Upload grayscale data as R32F
    gl$2.texImage2D(gl$2.TEXTURE_2D, 0, gl$2.R32F, width, height, 0, gl$2.RED, gl$2.FLOAT, data);
    gl$2.texParameteri(gl$2.TEXTURE_2D, gl$2.TEXTURE_WRAP_S, gl$2.CLAMP_TO_EDGE);
    gl$2.texParameteri(gl$2.TEXTURE_2D, gl$2.TEXTURE_WRAP_T, gl$2.CLAMP_TO_EDGE);
    gl$2.texParameteri(gl$2.TEXTURE_2D, gl$2.TEXTURE_MIN_FILTER, gl$2.NEAREST);
    gl$2.texParameteri(gl$2.TEXTURE_2D, gl$2.TEXTURE_MAG_FILTER, gl$2.NEAREST);
    return texture;
}
function createFramebuffer$3(width, height) {
    if (!gl$2)
        return null;
    const fb = gl$2.createFramebuffer();
    const tex = gl$2.createTexture();
    if (!fb || !tex)
        return null;
    gl$2.bindTexture(gl$2.TEXTURE_2D, tex);
    gl$2.texImage2D(gl$2.TEXTURE_2D, 0, gl$2.RGBA32F, width, height, 0, gl$2.RGBA, gl$2.FLOAT, null);
    gl$2.texParameteri(gl$2.TEXTURE_2D, gl$2.TEXTURE_WRAP_S, gl$2.CLAMP_TO_EDGE);
    gl$2.texParameteri(gl$2.TEXTURE_2D, gl$2.TEXTURE_WRAP_T, gl$2.CLAMP_TO_EDGE);
    gl$2.texParameteri(gl$2.TEXTURE_2D, gl$2.TEXTURE_MIN_FILTER, gl$2.NEAREST);
    gl$2.texParameteri(gl$2.TEXTURE_2D, gl$2.TEXTURE_MAG_FILTER, gl$2.NEAREST);
    gl$2.bindFramebuffer(gl$2.FRAMEBUFFER, fb);
    gl$2.framebufferTexture2D(gl$2.FRAMEBUFFER, gl$2.COLOR_ATTACHMENT0, gl$2.TEXTURE_2D, tex, 0);
    const status = gl$2.checkFramebufferStatus(gl$2.FRAMEBUFFER);
    if (status !== gl$2.FRAMEBUFFER_COMPLETE) {
        console.error('Framebuffer incomplete:', status);
        gl$2.deleteFramebuffer(fb);
        gl$2.deleteTexture(tex);
        return null;
    }
    gl$2.bindFramebuffer(gl$2.FRAMEBUFFER, null);
    return { fb, tex };
}
function readResult$2(fb, width, height) {
    if (!gl$2)
        return new Float32Array(0);
    gl$2.bindFramebuffer(gl$2.FRAMEBUFFER, fb);
    const pixels = new Float32Array(width * height * 4);
    gl$2.readPixels(0, 0, width, height, gl$2.RGBA, gl$2.FLOAT, pixels);
    // Extract red channel only
    const result = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        result[i] = pixels[i * 4];
    }
    gl$2.bindFramebuffer(gl$2.FRAMEBUFFER, null);
    return result;
}
function renderPass$2(program, inputTex, outputFb, width, height, uniforms) {
    if (!gl$2 || !quadVAO$2)
        return;
    gl$2.useProgram(program);
    gl$2.bindFramebuffer(gl$2.FRAMEBUFFER, outputFb);
    gl$2.viewport(0, 0, width, height);
    // Bind input texture
    gl$2.activeTexture(gl$2.TEXTURE0);
    gl$2.bindTexture(gl$2.TEXTURE_2D, inputTex);
    gl$2.uniform1i(gl$2.getUniformLocation(program, 'u_image'), 0);
    // Set uniforms
    for (const [name, value] of Object.entries(uniforms)) {
        const loc = gl$2.getUniformLocation(program, name);
        if (loc === null)
            continue;
        if (Array.isArray(value)) {
            if (value.length === 2)
                gl$2.uniform2fv(loc, value);
            else if (value.length === 3)
                gl$2.uniform3fv(loc, value);
            else if (value.length === 4)
                gl$2.uniform4fv(loc, value);
        }
        else if (Number.isInteger(value)) {
            gl$2.uniform1i(loc, value);
        }
        else {
            gl$2.uniform1f(loc, value);
        }
    }
    // Draw
    gl$2.bindVertexArray(quadVAO$2);
    gl$2.drawArrays(gl$2.TRIANGLE_STRIP, 0, 4);
    gl$2.bindVertexArray(null);
}
// ============================================================================
// BILATERAL FILTER - WebGL Implementation
// ============================================================================
let BilateralFilterWebGL$1 = class BilateralFilterWebGL extends BaseWebGLStrategy {
    static async isSupported() {
        return isWebGLAvailable$2();
    }
    static async getUnsupportedReason() {
        return isWebGLAvailable$2() ? undefined : 'WebGL 2.0 is not available in this environment';
    }
    async apply(input, config) {
        const cfg = { ...DEFAULT_BILATERAL_CONFIG$3, ...config };
        const gl = getGL$2();
        if (!gl) {
            throw new Error('BilateralFilterWebGL: WebGL 2.0 is not available in this environment.');
        }
        const { width, height, data } = input;
        const sigmaSpatial = cfg.sigmaSpatial;
        const sigmaRange = cfg.sigmaRange;
        const radiusMultiplier = cfg.radiusMultiplier ?? 2;
        const radius = Math.ceil(sigmaSpatial * radiusMultiplier);
        // Resize canvas if needed
        if (canvas$2.width !== width || canvas$2.height !== height) {
            canvas$2.width = width;
            canvas$2.height = height;
        }
        return this.runGuarded(gl, () => {
            const program = createProgram$5(source$R, 'bilateral');
            if (!program) {
                throw new Error('BilateralFilterWebGL: failed to compile/link shader program.');
            }
            const inputTex = createInputTexture$2(data, width, height);
            const output = createFramebuffer$3(width, height);
            if (!inputTex || !output) {
                if (inputTex)
                    gl.deleteTexture(inputTex);
                throw new Error('BilateralFilterWebGL: failed to create input texture or framebuffer.');
            }
            renderPass$2(program, inputTex, output.fb, width, height, {
                u_texelSize: [1.0 / width, 1.0 / height],
                u_sigmaSpatial2: 2.0 * sigmaSpatial * sigmaSpatial,
                u_sigmaRange2: 2.0 * sigmaRange * sigmaRange,
                u_radius: radius,
            });
            const result = readResult$2(output.fb, width, height);
            // Cleanup
            gl.deleteTexture(inputTex);
            gl.deleteTexture(output.tex);
            gl.deleteFramebuffer(output.fb);
            return { data: result, width, height };
        });
    }
};
// ============================================================================
// GAUSSIAN BLUR - Separable WebGL Implementation (Very Fast)
// ============================================================================
let GaussianBlurWebGL$1 = class GaussianBlurWebGL extends BaseWebGLStrategy {
    static async isSupported() {
        return isWebGLAvailable$2();
    }
    static async getUnsupportedReason() {
        return isWebGLAvailable$2() ? undefined : 'WebGL 2.0 is not available in this environment';
    }
    async apply(input, config) {
        const sigma = config.sigma ?? DEFAULT_GAUSSIAN_CONFIG.sigma;
        if (sigma < 0.1) {
            return { data: new Float32Array(input.data), width: input.width, height: input.height };
        }
        const gl = getGL$2();
        if (!gl) {
            throw new Error('GaussianBlurWebGL: WebGL 2.0 is not available in this environment.');
        }
        const { width, height, data } = input;
        const radius = Math.ceil(sigma * 3);
        const sigma2 = 2.0 * sigma * sigma;
        if (canvas$2.width !== width || canvas$2.height !== height) {
            canvas$2.width = width;
            canvas$2.height = height;
        }
        return this.runGuarded(gl, () => {
            const hProgram = createProgram$5(source$P, 'gaussianH');
            const vProgram = createProgram$5(source$O, 'gaussianV');
            if (!hProgram || !vProgram) {
                throw new Error('GaussianBlurWebGL: failed to compile/link shader program.');
            }
            const inputTex = createInputTexture$2(data, width, height);
            const tempFb = createFramebuffer$3(width, height);
            const outputFb = createFramebuffer$3(width, height);
            if (!inputTex || !tempFb || !outputFb) {
                if (inputTex)
                    gl.deleteTexture(inputTex);
                if (tempFb) {
                    gl.deleteFramebuffer(tempFb.fb);
                    gl.deleteTexture(tempFb.tex);
                }
                throw new Error('GaussianBlurWebGL: failed to create input texture or framebuffer.');
            }
            // Horizontal pass
            renderPass$2(hProgram, inputTex, tempFb.fb, width, height, {
                u_texelSizeX: 1.0 / width,
                u_radius: radius,
                u_sigma2: sigma2,
            });
            // Vertical pass
            renderPass$2(vProgram, tempFb.tex, outputFb.fb, width, height, {
                u_texelSizeY: 1.0 / height,
                u_radius: radius,
                u_sigma2: sigma2,
            });
            const result = readResult$2(outputFb.fb, width, height);
            // Cleanup
            gl.deleteTexture(inputTex);
            gl.deleteTexture(tempFb.tex);
            gl.deleteFramebuffer(tempFb.fb);
            gl.deleteTexture(outputFb.tex);
            gl.deleteFramebuffer(outputFb.fb);
            return { data: result, width, height };
        });
    }
};
// ============================================================================
// MEDIAN FILTER - WebGL Approximation using Weighted Histogram
// ============================================================================
let MedianFilterWebGL$1 = class MedianFilterWebGL extends BaseWebGLStrategy {
    static async isSupported() {
        return isWebGLAvailable$2();
    }
    static async getUnsupportedReason() {
        return isWebGLAvailable$2() ? undefined : 'WebGL 2.0 is not available in this environment';
    }
    async apply(input, config = {}) {
        const cfg = { ...DEFAULT_MEDIAN_CONFIG$3, ...config };
        const gl = getGL$2();
        if (!gl) {
            throw new Error('MedianFilterWebGL: WebGL 2.0 is not available in this environment.');
        }
        const { width, height, data } = input;
        const radius = cfg.radius;
        if (canvas$2.width !== width || canvas$2.height !== height) {
            canvas$2.width = width;
            canvas$2.height = height;
        }
        return this.runGuarded(gl, () => {
            // Use exact sorting for small kernels, histogram for large
            const shaderSource = radius <= 2 ? source$M : source$L;
            const cacheKey = radius <= 2 ? 'medianSmall' : 'medianLarge';
            const program = createProgram$5(shaderSource, cacheKey);
            if (!program) {
                throw new Error('MedianFilterWebGL: failed to compile/link shader program.');
            }
            const inputTex = createInputTexture$2(data, width, height);
            const output = createFramebuffer$3(width, height);
            if (!inputTex || !output) {
                if (inputTex)
                    gl.deleteTexture(inputTex);
                throw new Error('MedianFilterWebGL: failed to create input texture or framebuffer.');
            }
            renderPass$2(program, inputTex, output.fb, width, height, {
                u_texelSize: [1.0 / width, 1.0 / height],
                u_radius: radius,
            });
            const result = readResult$2(output.fb, width, height);
            // Cleanup
            gl.deleteTexture(inputTex);
            gl.deleteTexture(output.tex);
            gl.deleteFramebuffer(output.fb);
            return { data: result, width, height };
        });
    }
};
// ============================================================================
// KUWAHARA FILTER - WebGL Implementation
// ============================================================================
let KuwaharaFilterWebGL$1 = class KuwaharaFilterWebGL extends BaseWebGLStrategy {
    static async isSupported() {
        return isWebGLAvailable$2();
    }
    static async getUnsupportedReason() {
        return isWebGLAvailable$2() ? undefined : 'WebGL 2.0 is not available in this environment';
    }
    async apply(input, config = {}) {
        const cfg = { ...DEFAULT_KUWAHARA_CONFIG$3, ...config };
        const gl = getGL$2();
        if (!gl) {
            throw new Error('KuwaharaFilterWebGL: WebGL 2.0 is not available in this environment.');
        }
        const { width, height, data } = input;
        const radius = cfg.radius;
        if (canvas$2.width !== width || canvas$2.height !== height) {
            canvas$2.width = width;
            canvas$2.height = height;
        }
        return this.runGuarded(gl, () => {
            const program = createProgram$5(source$N, 'kuwahara');
            if (!program) {
                throw new Error('KuwaharaFilterWebGL: failed to compile/link shader program.');
            }
            const inputTex = createInputTexture$2(data, width, height);
            const output = createFramebuffer$3(width, height);
            if (!inputTex || !output) {
                if (inputTex)
                    gl.deleteTexture(inputTex);
                throw new Error('KuwaharaFilterWebGL: failed to create input texture or framebuffer.');
            }
            renderPass$2(program, inputTex, output.fb, width, height, {
                u_texelSize: [1.0 / width, 1.0 / height],
                u_radius: radius,
            });
            const result = readResult$2(output.fb, width, height);
            // Cleanup
            gl.deleteTexture(inputTex);
            gl.deleteTexture(output.tex);
            gl.deleteFramebuffer(output.fb);
            return { data: result, width, height };
        });
    }
};
// ============================================================================
// CONTRAST ENHANCEMENT - WebGL Implementation
// ============================================================================
let ContrastEnhancerWebGL$1 = class ContrastEnhancerWebGL extends BaseWebGLStrategy {
    static async isSupported() {
        return isWebGLAvailable$2();
    }
    static async getUnsupportedReason() {
        return isWebGLAvailable$2() ? undefined : 'WebGL 2.0 is not available in this environment';
    }
    async apply(input, config) {
        const { blackPoint, whitePoint } = { ...DEFAULT_CONTRAST_ENHANCEMENT_CONFIG, ...config };
        const gl = getGL$2();
        if (!gl) {
            throw new Error('ContrastEnhancerWebGL: WebGL 2.0 is not available in this environment.');
        }
        const { width, height, data } = input;
        // Calculate percentiles on CPU (fast enough, O(n log n)) - this is
        // inherent to the algorithm, not a fallback path.
        const sorted = new Float32Array(data).sort((a, b) => a - b);
        const minVal = sorted[Math.floor(data.length * blackPoint)];
        const maxVal = sorted[Math.floor(data.length * whitePoint)];
        if (canvas$2.width !== width || canvas$2.height !== height) {
            canvas$2.width = width;
            canvas$2.height = height;
        }
        return this.runGuarded(gl, () => {
            const program = createProgram$5(source$Q, 'contrast');
            if (!program) {
                throw new Error('ContrastEnhancerWebGL: failed to compile/link shader program.');
            }
            const inputTex = createInputTexture$2(data, width, height);
            const output = createFramebuffer$3(width, height);
            if (!inputTex || !output) {
                if (inputTex)
                    gl.deleteTexture(inputTex);
                throw new Error('ContrastEnhancerWebGL: failed to create input texture or framebuffer.');
            }
            renderPass$2(program, inputTex, output.fb, width, height, {
                u_minVal: minVal,
                u_maxVal: maxVal,
            });
            const result = readResult$2(output.fb, width, height);
            // Cleanup
            gl.deleteTexture(inputTex);
            gl.deleteTexture(output.tex);
            gl.deleteFramebuffer(output.fb);
            return { data: result, width, height };
        });
    }
};
// ============================================================================
// QUANTIZATION - WebGL Implementation
// ============================================================================
let QuantizerWebGL$1 = class QuantizerWebGL extends BaseWebGLStrategy {
    static async isSupported() {
        return isWebGLAvailable$2();
    }
    static async getUnsupportedReason() {
        return isWebGLAvailable$2() ? undefined : 'WebGL 2.0 is not available in this environment';
    }
    async apply(input, config) {
        const levels = config.levels ?? DEFAULT_QUANTIZER_CONFIG.levels;
        const gl = getGL$2();
        if (!gl) {
            throw new Error('QuantizerWebGL: WebGL 2.0 is not available in this environment.');
        }
        const { width, height, data } = input;
        if (canvas$2.width !== width || canvas$2.height !== height) {
            canvas$2.width = width;
            canvas$2.height = height;
        }
        return this.runGuarded(gl, () => {
            const program = createProgram$5(source$K, 'quantize');
            if (!program) {
                throw new Error('QuantizerWebGL: failed to compile/link shader program.');
            }
            const inputTex = createInputTexture$2(data, width, height);
            const output = createFramebuffer$3(width, height);
            if (!inputTex || !output) {
                if (inputTex)
                    gl.deleteTexture(inputTex);
                throw new Error('QuantizerWebGL: failed to create input texture or framebuffer.');
            }
            renderPass$2(program, inputTex, output.fb, width, height, {
                u_levels: levels,
            });
            const result = readResult$2(output.fb, width, height);
            // Cleanup
            gl.deleteTexture(inputTex);
            gl.deleteTexture(output.tex);
            gl.deleteFramebuffer(output.fb);
            return { data: result, width, height };
        });
    }
};
// ============================================================================
// UTILITY EXPORTS
// ============================================================================
/**
 * Check if WebGL 2.0 is available
 */
function isWebGLAvailable$2() {
    return getGL$2() !== null;
}
/**
 * Cleanup all WebGL resources
 */
function disposeWebGL$1() {
    if (!gl$2)
        return;
    // Delete cached programs
    programCache$2.forEach(program => gl$2.deleteProgram(program));
    programCache$2.clear();
    // Delete VAO
    if (quadVAO$2) {
        gl$2.deleteVertexArray(quadVAO$2);
        quadVAO$2 = null;
    }
    gl$2 = null;
    canvas$2 = null;
}

var webgl$1 = /*#__PURE__*/Object.freeze({
    __proto__: null,
    BilateralFilter: BilateralFilterWebGL$1,
    BilateralFilterWebGL: BilateralFilterWebGL$1,
    ContrastEnhancer: ContrastEnhancerWebGL$1,
    ContrastEnhancerWebGL: ContrastEnhancerWebGL$1,
    GaussianBlur: GaussianBlurWebGL$1,
    GaussianBlurWebGL: GaussianBlurWebGL$1,
    KuwaharaFilter: KuwaharaFilterWebGL$1,
    KuwaharaFilterWebGL: KuwaharaFilterWebGL$1,
    MedianFilter: MedianFilterWebGL$1,
    MedianFilterWebGL: MedianFilterWebGL$1,
    Quantizer: QuantizerWebGL$1,
    QuantizerWebGL: QuantizerWebGL$1,
    disposeWebGL: disposeWebGL$1,
    isWebGLAvailable: isWebGLAvailable$2
});

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/shaders/webgpu/bilateral.wgsl
// Regenerate with `npm run build:shaders`.
const source$J = `struct Params {
  width: u32,
  height: u32,
  radius: u32,
  rowOffset: u32,
  sigmaSpatial2: f32,
  sigmaRange2: f32,
  _pad1: f32,
  _pad2: f32,
};

// Pipeline-overridable — real value supplied via
// GPUComputePipelineDescriptor.compute.constants (see getPipeline() in
// webgpu.ts, which injects it for every pipeline by default).
override WORKGROUP_SIZE: u32 = 8u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputImage: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputImage: array<f32>;
@group(0) @binding(3) var<storage, read> spatialWeights: array<f32>;

fn samplePixel(x: i32, y: i32) -> f32 {
  let cx = clamp(x, 0, i32(params.width) - 1);
  let cy = clamp(y, 0, i32(params.height) - 1);
  return inputImage[cy * i32(params.width) + cx];
}

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  // gid.y is relative to the current chunk; rowOffset shifts it back into
  // the coordinate space of the full image.
  let y = i32(gid.y) + i32(params.rowOffset);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }

  let r = i32(params.radius);
  let center = samplePixel(x, y);

  var sum: f32 = 0.0;
  var weightSum: f32 = 0.0;
  var idx: u32 = 0u;

  for (var dy = -r; dy <= r; dy = dy + 1) {
    for (var dx = -r; dx <= r; dx = dx + 1) {
      let neighbor = samplePixel(x + dx, y + dy);
      let diff = neighbor - center;
      let rangeWeight = exp(-(diff * diff) / params.sigmaRange2);
      let weight = spatialWeights[idx] * rangeWeight;
      sum = sum + neighbor * weight;
      weightSum = weightSum + weight;
      idx = idx + 1u;
    }
  }

  outputImage[y * i32(params.width) + x] = select(center, sum / weightSum, weightSum > 0.0);
}
`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/shaders/webgpu/kuwahara.wgsl
// Regenerate with `npm run build:shaders`.
const source$I = `struct Params {
  width: u32,
  height: u32,
  radius: u32,
  _pad: u32,
};

override WORKGROUP_SIZE: u32 = 8u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputImage: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputImage: array<f32>;

fn samplePixel(x: i32, y: i32) -> f32 {
  let cx = clamp(x, 0, i32(params.width) - 1);
  let cy = clamp(y, 0, i32(params.height) - 1);
  return inputImage[cy * i32(params.width) + cx];
}

fn quadrantStats(x: i32, y: i32, x0: i32, x1: i32, y0: i32, y1: i32) -> vec2<f32> {
  var sum: f32 = 0.0;
  var sumSq: f32 = 0.0;
  var count: f32 = 0.0;
  for (var dy = y0; dy <= y1; dy = dy + 1) {
    for (var dx = x0; dx <= x1; dx = dx + 1) {
      let v = samplePixel(x + dx, y + dy);
      sum = sum + v;
      sumSq = sumSq + v * v;
      count = count + 1.0;
    }
  }
  let mean = sum / count;
  let variance = (sumSq / count) - (mean * mean);
  return vec2<f32>(mean, variance);
}

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }

  let r = i32(params.radius);

  // Four quadrants: top-left, top-right, bottom-left, bottom-right.
  let q0 = quadrantStats(x, y, -r, 0, -r, 0);
  let q1 = quadrantStats(x, y, 0, r, -r, 0);
  let q2 = quadrantStats(x, y, -r, 0, 0, r);
  let q3 = quadrantStats(x, y, 0, r, 0, r);

  var bestMean = q0.x;
  var minVariance = q0.y;

  if (q1.y < minVariance) { minVariance = q1.y; bestMean = q1.x; }
  if (q2.y < minVariance) { minVariance = q2.y; bestMean = q2.x; }
  if (q3.y < minVariance) { minVariance = q3.y; bestMean = q3.x; }

  outputImage[y * i32(params.width) + x] = bestMean;
}
`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/shaders/webgpu/gaussian.wgsl
// Regenerate with `npm run build:shaders`.
const source$H = `struct Params {
  width: u32,
  height: u32,
  radius: u32,
  _pad: u32,
};

override WORKGROUP_SIZE: u32 = 8u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputImage: array<f32>;
@group(0) @binding(2) var<storage, read> kernelWeights: array<f32>;
@group(0) @binding(3) var<storage, read_write> outputImage: array<f32>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main_h(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }
  let r = i32(params.radius);
  var sum: f32 = 0.0;
  for (var k = 0; k <= 2 * r; k = k + 1) {
    let sx = clamp(x + k - r, 0, i32(params.width) - 1);
    sum = sum + inputImage[y * i32(params.width) + sx] * kernelWeights[k];
  }
  outputImage[y * i32(params.width) + x] = sum;
}

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main_v(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }
  let r = i32(params.radius);
  var sum: f32 = 0.0;
  for (var k = 0; k <= 2 * r; k = k + 1) {
    let sy = clamp(y + k - r, 0, i32(params.height) - 1);
    sum = sum + inputImage[sy * i32(params.width) + x] * kernelWeights[k];
  }
  outputImage[y * i32(params.width) + x] = sum;
}
`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/shaders/webgpu/histogram.wgsl
// Regenerate with `npm run build:shaders`.
const source$G = `struct Params {
  width: u32,
  height: u32,
  _pad0: u32,
  _pad1: u32,
};

override WORKGROUP_SIZE: u32 = 8u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputImage: array<f32>;
@group(0) @binding(2) var<storage, read_write> histogram: array<atomic<u32>>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }
  let v = clamp(inputImage[y * i32(params.width) + x], 0.0, 1.0);
  let bin = u32(v * 255.0 + 0.5);
  atomicAdd(&histogram[min(bin, 255u)], 1u);
}
`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/shaders/webgpu/stretch.wgsl
// Regenerate with `npm run build:shaders`.
const source$F = `struct Params {
  width: u32,
  height: u32,
  minVal: f32,
  range: f32,
};

override WORKGROUP_SIZE: u32 = 8u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputImage: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputImage: array<f32>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }
  let idx = y * i32(params.width) + x;
  let v = (inputImage[idx] - params.minVal) / params.range;
  outputImage[idx] = clamp(v, 0.0, 1.0);
}
`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/shaders/webgpu/quantize.wgsl
// Regenerate with `npm run build:shaders`.
const source$E = `struct Params {
  width: u32,
  height: u32,
  step: f32,
  _pad: f32,
};

override WORKGROUP_SIZE: u32 = 8u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputImage: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputImage: array<f32>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }
  let idx = y * i32(params.width) + x;
  outputImage[idx] = round(inputImage[idx] / params.step) * params.step;
}
`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/shaders/webgpu/median.wgsl
// Regenerate with `npm run build:shaders`.
const source$D = `struct Params {
  width: u32,
  height: u32,
  radius: u32,
  _pad: u32,
};

override WORKGROUP_SIZE: u32 = 8u;

// N (the per-pixel neighborhood size, (2*radius+1)^2) sizes a plain
// function-local \`var\`, not a \`var<workgroup>\` one — WGSL's override-as-
// array-size exception only covers the latter, so N can't become an
// \`override\`. It has to stay a real \`const\`, resolved at shader-module
// creation. That means it genuinely can't be fixed at build time; a new
// module is compiled per distinct radius, same as before. __N__ is
// substituted at runtime in medianShaderSource() (webgpu.ts) — the one
// remaining spot in this codebase that still needs string templating,
// and for a language-level reason rather than convenience.
const N: u32 = __N__u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputImage: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputImage: array<f32>;

fn samplePixel(x: i32, y: i32) -> f32 {
  let cx = clamp(x, 0, i32(params.width) - 1);
  let cy = clamp(y, 0, i32(params.height) - 1);
  return inputImage[cy * i32(params.width) + cx];
}

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }

  let r = i32(params.radius);
  var vals: array<f32, N>;
  var idx: u32 = 0u;
  for (var dy = -r; dy <= r; dy = dy + 1) {
    for (var dx = -r; dx <= r; dx = dx + 1) {
      vals[idx] = samplePixel(x + dx, y + dy);
      idx = idx + 1u;
    }
  }

  // Insertion sort: O(n^2), fine for the small neighborhoods used here
  // (n = (2*radius+1)^2, e.g. 25 at radius 2).
  for (var i = 1u; i < N; i = i + 1u) {
    let key = vals[i];
    var j = i;
    while (j > 0u && vals[j - 1u] > key) {
      vals[j] = vals[j - 1u];
      j = j - 1u;
    }
    vals[j] = key;
  }

  outputImage[y * i32(params.width) + x] = vals[N / 2u];
}
`;

/**
 * WebGPU-accelerated preprocessing module for XDoG/FDoG
 *
 * Even faster than WebGL implementations
 */
/* ==================================================================== */
/* GPU device management                                                */
/* ==================================================================== */
let cachedDevice$1 = null;
let deviceInitPromise$1 = null;
/**
 * Deeper async check: confirms an adapter is actually obtainable, not
 * just that `navigator.gpu` exists.
 */
async function getWebGPUUnsupportedReason$1() {
    if (typeof navigator === 'undefined' || !navigator.gpu) {
        return 'navigator.gpu is not available in this environment';
    }
    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            return 'No suitable GPU adapter was found';
        }
    }
    catch (err) {
        return `Failed to request a GPU adapter: ${err.message}`;
    }
    return undefined;
}
async function getWebGPUDevice$1() {
    if (cachedDevice$1)
        return cachedDevice$1;
    if (deviceInitPromise$1)
        return deviceInitPromise$1;
    deviceInitPromise$1 = (async () => {
        if (!isWebGLComputeSupported()) {
            throw new Error('WebGPU is not supported in this environment (navigator.gpu is missing)');
        }
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            throw new Error('Failed to acquire a WebGPU adapter');
        }
        const device = await adapter.requestDevice();
        device.lost.then((info) => {
            // Invalidate the cache so the next call reinitializes a fresh device.
            cachedDevice$1 = null;
            deviceInitPromise$1 = null;
            clearShaderCaches$1();
            console.warn(`WebGPU device lost: ${info.message}`);
        });
        cachedDevice$1 = device;
        return device;
    })();
    return deviceInitPromise$1;
}
/** Release the cached device. Mainly useful for tests / hot reload. */
function disposeWebGPU$1() {
    cachedDevice$1?.destroy();
    cachedDevice$1 = null;
    deviceInitPromise$1 = null;
}
/* ==================================================================== */
/* Low-level GPU helpers                                                 */
/* ==================================================================== */
const WORKGROUP_SIZE$3 = 8;
function workgroupCount$1(size) {
    return Math.ceil(size / WORKGROUP_SIZE$3);
}
function createUniformBuffer$1(device, data) {
    const buffer = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data));
    buffer.unmap();
    return buffer;
}
function createReadOnlyStorageBuffer$1(device, data) {
    const buffer = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
}
function createOutputStorageBuffer$1(device, byteLength) {
    return device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
}
async function readFloat32Buffer$1(device, buffer, length) {
    const byteLength = length * 4;
    const staging = device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(buffer, 0, staging, 0, byteLength);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const copy = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return copy;
}
// Shader modules are cached by cacheKey so pipelines that share a module
// (e.g. the two Gaussian blur passes) don't recompile it twice.
const moduleCache$1 = new Map();
const pipelineCache$1 = new Map();
function getShaderModule$1(device, cacheKey, code) {
    let module = moduleCache$1.get(cacheKey);
    if (!module) {
        module = device.createShaderModule({ code });
        moduleCache$1.set(cacheKey, module);
    }
    return module;
}
// in webgpu.ts, near moduleCache/pipelineCache
function clearShaderCaches$1() {
    moduleCache$1.clear();
    pipelineCache$1.clear();
}
function getPipeline$1(device, cacheKey, code, entryPoint) {
    const key = `${cacheKey}::${entryPoint}`;
    let pipeline = pipelineCache$1.get(key);
    if (!pipeline) {
        const module = getShaderModule$1(device, cacheKey, code);
        pipeline = device.createComputePipeline({
            layout: 'auto',
            compute: { module, entryPoint, constants: { WORKGROUP_SIZE: WORKGROUP_SIZE$3 } },
        });
        pipelineCache$1.set(key, pipeline);
    }
    return pipeline;
}
function dispatch$1(device, pipeline, bindGroup, width, height) {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupCount$1(width), workgroupCount$1(height));
    pass.end();
    device.queue.submit([encoder.finish()]);
}
/* ==================================================================== */
/* Bilateral Filter                                                      */
/* ==================================================================== */
/**
 * The `rowOffset` field lets a single dispatch cover only a band of rows
 * of a much taller image (see the chunking loop in `process()` below).
 * `spatialWeights` is a precomputed (2*radius+1)^2 lookup table for the
 * spatial term of the bilateral weight, which depends only on (dx, dy)
 * and is identical for every pixel. Computing it on the CPU once instead
 * of calling `exp()` for it on every shader invocation roughly halves the
 * transcendental-function work in the inner loop.
 */
let GPUBilateralFilter$1 = class GPUBilateralFilter extends BaseWebGPUStrategy {
    static async isSupported() {
        return isWebGLComputeSupported() && (await getWebGPUUnsupportedReason$1()) === undefined;
    }
    static getUnsupportedReason() {
        return getWebGPUUnsupportedReason$1();
    }
    async apply(input, config) {
        const device = await getWebGPUDevice$1();
        const { width, height } = input;
        const cfg = { ...DEFAULT_BILATERAL_CONFIG$3, ...config };
        const radius = Math.ceil(cfg.sigmaSpatial * (cfg.radiusMultiplier ?? 2));
        const side = 2 * radius + 1;
        if (radius > 15) {
            console.warn(`GPUBilateralFilter: radius=${radius} (from sigmaSpatial=${cfg.sigmaSpatial}) means ` +
                `${side * side} samples/pixel. On large images this can still be expensive enough ` +
                `to run long even chunked; consider a smaller sigmaSpatial/radiusMultiplier if you ` +
                `see slowdowns or device loss.`);
        }
        // Precompute the spatial weight term (depends only on dx, dy - identical
        // for every pixel) once on the CPU instead of recomputing it with exp()
        // on every shader invocation for every pixel.
        const spatialLUT = new Float32Array(side * side);
        {
            const sigmaSpatial2 = 2 * cfg.sigmaSpatial * cfg.sigmaSpatial;
            let li = 0;
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    spatialLUT[li++] = Math.exp(-(dx * dx + dy * dy) / sigmaSpatial2);
                }
            }
        }
        const uniformData = new ArrayBuffer(32);
        const u32View = new Uint32Array(uniformData);
        const f32View = new Float32Array(uniformData);
        u32View[0] = width;
        u32View[1] = height;
        u32View[2] = radius;
        u32View[3] = 0; // rowOffset - updated per chunk in the loop below
        f32View[4] = 2 * cfg.sigmaSpatial * cfg.sigmaSpatial;
        f32View[5] = 2 * cfg.sigmaRange * cfg.sigmaRange;
        return this.runGuarded(device, async () => {
            const uniformBuffer = createUniformBuffer$1(device, uniformData);
            const inputBuffer = createReadOnlyStorageBuffer$1(device, input.data);
            const outputBuffer = createOutputStorageBuffer$1(device, input.data.byteLength);
            const spatialWeightsBuffer = createReadOnlyStorageBuffer$1(device, spatialLUT);
            const pipeline = getPipeline$1(device, 'bilateral', source$J, 'main');
            const bindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: inputBuffer } },
                    { binding: 2, resource: { buffer: outputBuffer } },
                    { binding: 3, resource: { buffer: spatialWeightsBuffer } },
                ],
            });
            // Large images combined with large radii make width * height *
            // (2*radius+1)^2 samples in a single dispatch, which can run long
            // enough to exceed the GPU driver's watchdog timeout and bring down
            // the whole device (VK_ERROR_DEVICE_LOST) instead of just failing
            // this operation. Splitting the work into row bands, each submitted
            // and awaited independently, keeps any single submission short.
            // ROWS_PER_CHUNK is sized so that each chunk does roughly the same
            // amount of total sampling work regardless of image width or radius.
            const ROWS_PER_CHUNK = Math.max(1, Math.floor(4_000_000 / (width * side * side)));
            for (let y0 = 0; y0 < height; y0 += ROWS_PER_CHUNK) {
                const rows = Math.min(ROWS_PER_CHUNK, height - y0);
                device.queue.writeBuffer(uniformBuffer, 12, new Uint32Array([y0]));
                const encoder = device.createCommandEncoder();
                const pass = encoder.beginComputePass();
                pass.setPipeline(pipeline);
                pass.setBindGroup(0, bindGroup);
                pass.dispatchWorkgroups(workgroupCount$1(width), workgroupCount$1(rows));
                pass.end();
                device.queue.submit([encoder.finish()]);
            }
            const resultData = await readFloat32Buffer$1(device, outputBuffer, width * height);
            uniformBuffer.destroy();
            inputBuffer.destroy();
            outputBuffer.destroy();
            spatialWeightsBuffer.destroy();
            return { data: resultData, width, height };
        });
    }
};
/* ==================================================================== */
/* Median Filter                                                         */
/* ==================================================================== */
// N (the per-pixel neighborhood size) sizes a function-local `var`, not a
// `var<workgroup>` one, so it can't become a WGSL `override`. The
// override-as-array-size exception only covers workgroup-address-space
// arrays (see median.wgsl's comment for the full explanation). It's a
// genuine `const`, so it still has to be baked per radius at the string
// level; a new shader module is compiled (and cached by getPipeline's
// cacheKey) for each distinct radius, same as before this migration.
function medianShaderSource$1(radius) {
    const side = 2 * radius + 1;
    const n = side * side;
    return source$D.replace('__N__', String(n));
}
let GPUMedianFilter$1 = class GPUMedianFilter extends BaseWebGPUStrategy {
    static async isSupported() {
        return isWebGLComputeSupported() && (await getWebGPUUnsupportedReason$1()) === undefined;
    }
    static getUnsupportedReason() {
        return getWebGPUUnsupportedReason$1();
    }
    async apply(input, config) {
        const cfg = { ...DEFAULT_MEDIAN_CONFIG$3, ...config };
        if (cfg.radius > 6) {
            console.warn(`GPUMedianFilter: radius=${cfg.radius} means a per-pixel ` +
                `neighborhood array of ${(2 * cfg.radius + 1) ** 2} elements, ` +
                `sorted in-shader with an O(n^2) insertion sort. This can get slow ` +
                `and register-heavy fast; consider a smaller radius on GPU.`);
        }
        const device = await getWebGPUDevice$1();
        const { width, height } = input;
        const radius = cfg.radius;
        const uniformData = new ArrayBuffer(16);
        const u32View = new Uint32Array(uniformData);
        u32View[0] = width;
        u32View[1] = height;
        u32View[2] = radius;
        return this.runGuarded(device, async () => {
            const uniformBuffer = createUniformBuffer$1(device, uniformData);
            const inputBuffer = createReadOnlyStorageBuffer$1(device, input.data);
            const outputBuffer = createOutputStorageBuffer$1(device, input.data.byteLength);
            const cacheKey = `median-r${radius}`;
            const pipeline = getPipeline$1(device, cacheKey, medianShaderSource$1(radius), 'main');
            const bindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: inputBuffer } },
                    { binding: 2, resource: { buffer: outputBuffer } },
                ],
            });
            dispatch$1(device, pipeline, bindGroup, width, height);
            const resultData = await readFloat32Buffer$1(device, outputBuffer, width * height);
            uniformBuffer.destroy();
            inputBuffer.destroy();
            outputBuffer.destroy();
            return { data: resultData, width, height };
        });
    }
};
/* ==================================================================== */
/* Kuwahara Filter                                                       */
/* ==================================================================== */
let GPUKuwaharaFilter$1 = class GPUKuwaharaFilter extends BaseWebGPUStrategy {
    static async isSupported() {
        return isWebGLComputeSupported() && (await getWebGPUUnsupportedReason$1()) === undefined;
    }
    static getUnsupportedReason() {
        return getWebGPUUnsupportedReason$1();
    }
    async apply(input, config) {
        const cfg = { ...DEFAULT_KUWAHARA_CONFIG$3, ...config };
        const device = await getWebGPUDevice$1();
        const { width, height } = input;
        const radius = cfg.radius;
        const uniformData = new ArrayBuffer(16);
        const u32View = new Uint32Array(uniformData);
        u32View[0] = width;
        u32View[1] = height;
        u32View[2] = radius;
        return this.runGuarded(device, async () => {
            const uniformBuffer = createUniformBuffer$1(device, uniformData);
            const inputBuffer = createReadOnlyStorageBuffer$1(device, input.data);
            const outputBuffer = createOutputStorageBuffer$1(device, input.data.byteLength);
            const pipeline = getPipeline$1(device, 'kuwahara', source$I, 'main');
            const bindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: inputBuffer } },
                    { binding: 2, resource: { buffer: outputBuffer } },
                ],
            });
            dispatch$1(device, pipeline, bindGroup, width, height);
            const resultData = await readFloat32Buffer$1(device, outputBuffer, width * height);
            uniformBuffer.destroy();
            inputBuffer.destroy();
            outputBuffer.destroy();
            return { data: resultData, width, height };
        });
    }
};
/* ==================================================================== */
/* Gaussian Blur (separable, two compute passes)                        */
/* ==================================================================== */
let GPUGaussianBlur$1 = class GPUGaussianBlur extends BaseWebGPUStrategy {
    static async isSupported() {
        return isWebGLComputeSupported() && (await getWebGPUUnsupportedReason$1()) === undefined;
    }
    static getUnsupportedReason() {
        return getWebGPUUnsupportedReason$1();
    }
    async apply(input, config) {
        const { width, height } = input;
        const cfg = { ...DEFAULT_GAUSSIAN_CONFIG, ...config };
        if (cfg.sigma < 0.1) {
            return { data: new Float32Array(input.data), width, height };
        }
        const device = await getWebGPUDevice$1();
        const radius = Math.ceil(cfg.sigma * 3);
        const kernelSize = radius * 2 + 1;
        const kernel = generateGaussianKernel$1(cfg.sigma, kernelSize);
        const uniformData = new ArrayBuffer(16);
        const u32View = new Uint32Array(uniformData);
        u32View[0] = width;
        u32View[1] = height;
        u32View[2] = radius;
        return this.runGuarded(device, async () => {
            const uniformBuffer = createUniformBuffer$1(device, uniformData);
            const inputBuffer = createReadOnlyStorageBuffer$1(device, input.data);
            const kernelBuffer = createReadOnlyStorageBuffer$1(device, new Float32Array(kernel));
            const tempBuffer = createOutputStorageBuffer$1(device, input.data.byteLength);
            const outputBuffer = createOutputStorageBuffer$1(device, input.data.byteLength);
            const pipelineH = getPipeline$1(device, 'gaussian', source$H, 'main_h');
            const pipelineV = getPipeline$1(device, 'gaussian', source$H, 'main_v');
            const bindGroupH = device.createBindGroup({
                layout: pipelineH.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: inputBuffer } },
                    { binding: 2, resource: { buffer: kernelBuffer } },
                    { binding: 3, resource: { buffer: tempBuffer } },
                ],
            });
            const bindGroupV = device.createBindGroup({
                layout: pipelineV.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: tempBuffer } },
                    { binding: 2, resource: { buffer: kernelBuffer } },
                    { binding: 3, resource: { buffer: outputBuffer } },
                ],
            });
            // Both passes are recorded on one command encoder before submission,
            // so the vertical pass reliably waits for the horizontal pass's writes
            // to tempBuffer (WebGPU commands within one queue submission execute
            // in program order with respect to buffer dependencies).
            const encoder = device.createCommandEncoder();
            let pass = encoder.beginComputePass();
            pass.setPipeline(pipelineH);
            pass.setBindGroup(0, bindGroupH);
            pass.dispatchWorkgroups(workgroupCount$1(width), workgroupCount$1(height));
            pass.end();
            pass = encoder.beginComputePass();
            pass.setPipeline(pipelineV);
            pass.setBindGroup(0, bindGroupV);
            pass.dispatchWorkgroups(workgroupCount$1(width), workgroupCount$1(height));
            pass.end();
            device.queue.submit([encoder.finish()]);
            const resultData = await readFloat32Buffer$1(device, outputBuffer, width * height);
            uniformBuffer.destroy();
            inputBuffer.destroy();
            kernelBuffer.destroy();
            tempBuffer.destroy();
            outputBuffer.destroy();
            return { data: resultData, width, height };
        });
    }
};
/* ==================================================================== */
/* Contrast Enhancement (histogram-based percentile approximation)      */
/* ==================================================================== */
let GPUContrastEnhancer$1 = class GPUContrastEnhancer extends BaseWebGPUStrategy {
    static async isSupported() {
        return isWebGLComputeSupported() && (await getWebGPUUnsupportedReason$1()) === undefined;
    }
    static getUnsupportedReason() {
        return getWebGPUUnsupportedReason$1();
    }
    /**
     * The CPU version sorts every pixel to find exact percentiles. Sorting
     * is a poor fit for a GPU compute pass, so this builds a 256-bin
     * histogram instead (one atomicAdd per pixel), reads the 1KB histogram
     * back to the CPU to locate the percentile bins, then runs a second,
     * fully GPU-resident pass to apply the stretch. This trades a small
     * amount of precision (bin width 1/255) for O(n) work instead of an
     * O(n log n) sort, at the cost of one small CPU/GPU sync point.
     *
     * The two GPU round-trips (histogram pass, then stretch pass) are each
     * wrapped in their own runGuarded scope rather than one scope spanning
     * both. The CPU-side histogram bucketing that happens between them
     * isn't GPU work, so it shouldn't sit inside a WebGPU error scope.
     */
    async apply(input, config) {
        const { blackPoint, whitePoint } = { ...DEFAULT_CONTRAST_ENHANCEMENT_CONFIG, ...config };
        const device = await getWebGPUDevice$1();
        const { width, height } = input;
        const size = width * height;
        const histUniform = new ArrayBuffer(16);
        new Uint32Array(histUniform).set([width, height, 0, 0]);
        const histogramU32 = await this.runGuarded(device, async () => {
            const histUniformBuffer = createUniformBuffer$1(device, histUniform);
            const histInputBuffer = createReadOnlyStorageBuffer$1(device, input.data);
            const histogramBuffer = device.createBuffer({
                size: 256 * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
            });
            device.queue.writeBuffer(histogramBuffer, 0, new Uint32Array(256));
            const histPipeline = getPipeline$1(device, 'histogram', source$G, 'main');
            const histBindGroup = device.createBindGroup({
                layout: histPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: histUniformBuffer } },
                    { binding: 1, resource: { buffer: histInputBuffer } },
                    { binding: 2, resource: { buffer: histogramBuffer } },
                ],
            });
            dispatch$1(device, histPipeline, histBindGroup, width, height);
            const result = await readUint32Buffer$1(device, histogramBuffer, 256);
            histUniformBuffer.destroy();
            histInputBuffer.destroy();
            histogramBuffer.destroy();
            return result;
        });
        const blackCount = blackPoint * size;
        const whiteCount = whitePoint * size;
        let cumulative = 0;
        let minBin = 0;
        let maxBin = 255;
        let foundMin = false;
        for (let bin = 0; bin < 256; bin++) {
            cumulative += histogramU32[bin];
            if (!foundMin && cumulative >= blackCount) {
                minBin = bin;
                foundMin = true;
            }
            if (cumulative >= whiteCount) {
                maxBin = bin;
                break;
            }
        }
        const minVal = minBin / 255;
        const maxVal = maxBin / 255;
        const range = maxVal - minVal;
        if (range < 0.01) {
            return { data: new Float32Array(input.data), width, height };
        }
        const stretchUniform = new ArrayBuffer(16);
        const stretchU32 = new Uint32Array(stretchUniform);
        const stretchF32 = new Float32Array(stretchUniform);
        stretchU32[0] = width;
        stretchU32[1] = height;
        stretchF32[2] = minVal;
        stretchF32[3] = range;
        return this.runGuarded(device, async () => {
            const stretchUniformBuffer = createUniformBuffer$1(device, stretchUniform);
            const stretchInputBuffer = createReadOnlyStorageBuffer$1(device, input.data);
            const outputBuffer = createOutputStorageBuffer$1(device, input.data.byteLength);
            const stretchPipeline = getPipeline$1(device, 'stretch', source$F, 'main');
            const stretchBindGroup = device.createBindGroup({
                layout: stretchPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: stretchUniformBuffer } },
                    { binding: 1, resource: { buffer: stretchInputBuffer } },
                    { binding: 2, resource: { buffer: outputBuffer } },
                ],
            });
            dispatch$1(device, stretchPipeline, stretchBindGroup, width, height);
            const resultData = await readFloat32Buffer$1(device, outputBuffer, width * height);
            stretchUniformBuffer.destroy();
            stretchInputBuffer.destroy();
            outputBuffer.destroy();
            return { data: resultData, width, height };
        });
    }
};
async function readUint32Buffer$1(device, buffer, length) {
    const byteLength = length * 4;
    const staging = device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(buffer, 0, staging, 0, byteLength);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const copy = new Uint32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return copy;
}
/* ==================================================================== */
/* Quantizer                                                             */
/* ==================================================================== */
let GPUQuantizer$1 = class GPUQuantizer extends BaseWebGPUStrategy {
    static async isSupported() {
        return isWebGLComputeSupported() && (await getWebGPUUnsupportedReason$1()) === undefined;
    }
    static getUnsupportedReason() {
        return getWebGPUUnsupportedReason$1();
    }
    async apply(input, config) {
        const cfg = { ...DEFAULT_QUANTIZER_CONFIG, ...config };
        const device = await getWebGPUDevice$1();
        const { width, height } = input;
        const step = 1 / (cfg.levels - 1);
        const uniformData = new ArrayBuffer(16);
        const u32View = new Uint32Array(uniformData);
        const f32View = new Float32Array(uniformData);
        u32View[0] = width;
        u32View[1] = height;
        f32View[2] = step;
        return this.runGuarded(device, async () => {
            const uniformBuffer = createUniformBuffer$1(device, uniformData);
            const inputBuffer = createReadOnlyStorageBuffer$1(device, input.data);
            const outputBuffer = createOutputStorageBuffer$1(device, input.data.byteLength);
            const pipeline = getPipeline$1(device, 'quantize', source$E, 'main');
            const bindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: inputBuffer } },
                    { binding: 2, resource: { buffer: outputBuffer } },
                ],
            });
            dispatch$1(device, pipeline, bindGroup, width, height);
            const resultData = await readFloat32Buffer$1(device, outputBuffer, width * height);
            uniformBuffer.destroy();
            inputBuffer.destroy();
            outputBuffer.destroy();
            return { data: resultData, width, height };
        });
    }
};
/* ==================================================================== */
/* Presets and pipeline (async-native equivalents of cpu.ts's)           */
/* ==================================================================== */
/**
 * Preset preprocessing pipelines for common use cases.
 * async GPU equivalents of `PreprocessingPresets` in cpu.ts.
 */
const GPUPreprocessingPresets = {
    /** Light preprocessing - minimal smoothing. Good for clean studio photos, illustrations. */
    light: (input) => new GPUBilateralFilter$1().apply(input, { sigmaSpatial: 2, sigmaRange: 0.08 }),
    /** Standard preprocessing - balanced smoothing. Good for most outdoor photos, portraits. */
    standard: (input) => new GPUBilateralFilter$1().apply(input, { sigmaSpatial: 4, sigmaRange: 0.1 }),
    /** Heavy preprocessing - aggressive noise removal. Good for very textured images. */
    heavy: async (input) => {
        let result = await new GPUBilateralFilter$1().apply(input, { sigmaSpatial: 5, sigmaRange: 0.12 });
        result = await new GPUBilateralFilter$1().apply(result, { sigmaSpatial: 3, sigmaRange: 0.1 });
        return result;
    },
    /** Artistic preprocessing - painterly smoothing. Good for stylized/artistic output. */
    artistic: async (input) => {
        let result = await new GPUKuwaharaFilter$1().apply(input, { radius: 4 });
        result = await new GPUBilateralFilter$1().apply(result, { sigmaSpatial: 2, sigmaRange: 0.08 });
        return result;
    },
    /** Photo preprocessing - for photos with grass/nature. Good for landscape, outdoor scenes. */
    nature: async (input) => {
        let result = await new GPUBilateralFilter$1().apply(input, { sigmaSpatial: 6, sigmaRange: 0.15 });
        result = await new GPUBilateralFilter$1().apply(result, { sigmaSpatial: 3, sigmaRange: 0.08 });
        return result;
    },
};

var webgpu = /*#__PURE__*/Object.freeze({
    __proto__: null,
    GPUBilateralFilter: GPUBilateralFilter$1,
    GPUContrastEnhancer: GPUContrastEnhancer$1,
    GPUGaussianBlur: GPUGaussianBlur$1,
    GPUKuwaharaFilter: GPUKuwaharaFilter$1,
    GPUMedianFilter: GPUMedianFilter$1,
    GPUPreprocessingPresets: GPUPreprocessingPresets,
    GPUQuantizer: GPUQuantizer$1,
    clearShaderCaches: clearShaderCaches$1,
    disposeWebGPU: disposeWebGPU$1,
    getWebGPUUnsupportedReason: getWebGPUUnsupportedReason$1
});

/**
 * Preprocessing module for XDoG/FDoG
 *
 * Provides filters to prepare images before line detection.
 * These help reduce noise and texture while preserving important edges.
 *
 * Section 3.2 of the paper discusses the importance of bilateral
 * preprocessing for "indication" - attenuating weak edges while
 * preserving strong edges.
 */
/**
 * Bilateral Filter
 *
 * Edge-preserving smoothing filter that averages pixels based on both
 * spatial proximity AND intensity similarity. This smooths out texture
 * (like grass) while keeping strong edges (like the car outline) sharp.
 *
 * This is the recommended preprocessing for most images.
 *
 * As mentioned in Section 3.2, bilateral filtering can serve as a
 * "prioritization mechanism" for indication - attenuating weak edges
 * while supporting strong edges.
 *
 * CPU is always available (BaseCPUStrategy.isSupported() / dispose() /
 * backend all apply unchanged). This is the universal fallback.
 */
let BilateralFilter$3 = class BilateralFilter extends BaseCPUStrategy {
    async apply(input, config) {
        const cfg = { ...DEFAULT_BILATERAL_CONFIG$3, ...config };
        const { width, height } = input;
        const output = createChannelImage$1(width, height);
        const radius = Math.ceil(cfg.sigmaSpatial * (cfg.radiusMultiplier ?? 2));
        const sigmaSpatial2 = 2 * cfg.sigmaSpatial * cfg.sigmaSpatial;
        const sigmaRange2 = 2 * cfg.sigmaRange * cfg.sigmaRange;
        // Precompute spatial weights
        const spatialWeights = [];
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const dist2 = dx * dx + dy * dy;
                spatialWeights.push(Math.exp(-dist2 / sigmaSpatial2));
            }
        }
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const centerValue = getPixel(input, x, y);
                let sum = 0;
                let weightSum = 0;
                let idx = 0;
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        const neighborValue = getPixel(input, nx, ny);
                        // Range weight based on intensity difference
                        const intensityDiff = neighborValue - centerValue;
                        const rangeWeight = Math.exp(-(intensityDiff * intensityDiff) / sigmaRange2);
                        // Combined weight
                        const weight = spatialWeights[idx] * rangeWeight;
                        sum += neighborValue * weight;
                        weightSum += weight;
                        idx++;
                    }
                }
                output.data[y * width + x] = weightSum > 0 ? sum / weightSum : centerValue;
            }
        }
        return output;
    }
};
/**
 * Median Filter
 *
 * Replaces each pixel with the median of its neighborhood.
 * Excellent for removing salt-and-pepper noise and small texture details.
 */
let MedianFilter$3 = class MedianFilter extends BaseCPUStrategy {
    async apply(input, config) {
        const cfg = { ...DEFAULT_MEDIAN_CONFIG$3, ...config };
        const { width, height } = input;
        const output = createChannelImage$1(width, height);
        const radius = cfg.radius;
        const kernelSize = (2 * radius + 1) * (2 * radius + 1);
        const values = new Array(kernelSize);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let idx = 0;
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        values[idx++] = getPixel(input, x + dx, y + dy);
                    }
                }
                // Sort and take median
                values.sort((a, b) => a - b);
                output.data[y * width + x] = values[Math.floor(kernelSize / 2)];
            }
        }
        return output;
    }
};
/**
 * Kuwahara Filter
 *
 * Artistic smoothing filter that creates a painterly effect.
 * Divides the neighborhood into 4 quadrants, finds the one with
 * lowest variance, and uses its mean. Creates flat regions with
 * preserved edges - great for a more stylized look.
 */
let KuwaharaFilter$3 = class KuwaharaFilter extends BaseCPUStrategy {
    async apply(input, config) {
        const cfg = { ...DEFAULT_KUWAHARA_CONFIG$3, ...config };
        const { width, height } = input;
        const output = createChannelImage$1(width, height);
        const r = cfg.radius;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                // Four quadrants: top-left, top-right, bottom-left, bottom-right
                const quadrants = [
                    { startX: -r, endX: 0, startY: -r, endY: 0 },
                    { startX: 0, endX: r, startY: -r, endY: 0 },
                    { startX: -r, endX: 0, startY: 0, endY: r },
                    { startX: 0, endX: r, startY: 0, endY: r },
                ];
                let minVariance = Infinity;
                let bestMean = getPixel(input, x, y);
                for (const q of quadrants) {
                    let sum = 0;
                    let sumSq = 0;
                    let count = 0;
                    for (let dy = q.startY; dy <= q.endY; dy++) {
                        for (let dx = q.startX; dx <= q.endX; dx++) {
                            const val = getPixel(input, x + dx, y + dy);
                            sum += val;
                            sumSq += val * val;
                            count++;
                        }
                    }
                    const mean = sum / count;
                    const variance = (sumSq / count) - (mean * mean);
                    if (variance < minVariance) {
                        minVariance = variance;
                        bestMean = mean;
                    }
                }
                output.data[y * width + x] = bestMean;
            }
        }
        return output;
    }
};
/**
 * Gaussian Blur
 *
 * Simple Gaussian smoothing. Less edge-preserving than bilateral,
 * but faster. Good for very noisy images or when used with small sigma.
 */
let GaussianBlur$3 = class GaussianBlur extends BaseCPUStrategy {
    async apply(input, config) {
        const { width, height } = input;
        const sigma = config.sigma ?? DEFAULT_GAUSSIAN_CONFIG.sigma;
        if (sigma < 0.1) {
            return { data: new Float32Array(input.data), width, height };
        }
        const radius = Math.ceil(sigma * 3);
        const kernelSize = radius * 2 + 1;
        const kernel = generateGaussianKernel$1(sigma, kernelSize);
        // Horizontal pass
        const temp = createChannelImage$1(width, height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let val = 0;
                for (let k = 0; k < kernelSize; k++) {
                    val += getPixel(input, x + k - radius, y) * kernel[k];
                }
                temp.data[y * width + x] = val;
            }
        }
        // Vertical pass
        const output = createChannelImage$1(width, height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let val = 0;
                for (let k = 0; k < kernelSize; k++) {
                    val += getPixel(temp, x, y + k - radius) * kernel[k];
                }
                output.data[y * width + x] = val;
            }
        }
        return output;
    }
};
/**
 * Contrast Enhancement
 *
 * Stretches the histogram to use the full 0-1 range.
 * Can help make edges more distinct before processing.
 */
let ContrastEnhancer$3 = class ContrastEnhancer extends BaseCPUStrategy {
    async apply(input, config) {
        const cfg = { ...DEFAULT_CONTRAST_ENHANCEMENT_CONFIG, ...config };
        const { width, height, data } = input;
        const output = createChannelImage$1(width, height);
        const size = width * height;
        // Find histogram percentiles
        const sorted = new Float32Array(data).sort();
        const minVal = sorted[Math.floor(size * cfg.blackPoint)];
        const maxVal = sorted[Math.floor(size * cfg.whitePoint)];
        const range = maxVal - minVal;
        if (range < 0.01) {
            return { data: new Float32Array(data), width, height };
        }
        for (let i = 0; i < size; i++) {
            output.data[i] = Math.max(0, Math.min(1, (data[i] - minVal) / range));
        }
        return output;
    }
};
/**
 * Quantize to reduce color levels
 *
 * Reduces the number of intensity levels, creating a posterized effect.
 * Can help reduce noise by grouping similar intensities together.
 */
let Quantizer$3 = class Quantizer extends BaseCPUStrategy {
    async apply(input, config) {
        const cfg = { ...DEFAULT_QUANTIZER_CONFIG, ...config };
        const { width, height, data } = input;
        const output = createChannelImage$1(width, height);
        const size = width * height;
        const step = 1 / (cfg.levels - 1);
        for (let i = 0; i < size; i++) {
            output.data[i] = Math.round(data[i] / step) * step;
        }
        return output;
    }
};
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
 * const filter = new LocalVarianceFilter({
 *   windowRadius: 2,
 *   normalizeByGradient: true,
 * });
 *
 * const textureMap = filter.apply(grayImage);
 * // textureMap.data[i] = texture strength at pixel i
 * // Now use textureMap with your own edge detection
 * ```
 */
class LocalVarianceFilter {
    /** CPU-only. No WebGL/WebGPU counterparts for this yet. */
    backend = 'cpu';
    defaultConfig = {
        windowRadius: 2,
        normalizeByGradient: true,
        varianceScale: 1.0,
        maxVariance: 1.0,
    };
    dispose() { }
    /**
     * Process using separable convolution (faster for large windows)
     * Variance = E[X^2] - E[X]^2
     * Compute box blur of X and X^2 separately, then combine
     */
    async apply(image, config) {
        const { width, height, data } = image;
        const cfg = { ...config, ...this.defaultConfig };
        const { windowRadius, normalizeByGradient, varianceScale, maxVariance } = cfg;
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
     * radii (1-4) this filter supports.
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
/**
 * Preset preprocessing pipelines for common use cases
 */
const EdgeAwareFilterPresets = {
    /**
     * Light preprocessing - minimal smoothing
     * Good for: Clean studio photos, illustrations
     */
    light: async (input) => {
        return await new BilateralFilter$3().apply(input, { sigmaSpatial: 2, sigmaRange: 0.08 });
    },
    /**
     * Standard preprocessing - balanced smoothing
     * Good for: Most outdoor photos, portraits
     */
    standard: async (input) => {
        return new BilateralFilter$3().apply(input, { sigmaSpatial: 4, sigmaRange: 0.1 });
    },
    /**
     * Heavy preprocessing - aggressive noise removal
     * Good for: Very textured images (grass, foliage, fabric)
     */
    heavy: async (input) => {
        let result = await new BilateralFilter$3().apply(input, { sigmaSpatial: 5, sigmaRange: 0.12 });
        result = await new BilateralFilter$3().apply(result, { sigmaSpatial: 3, sigmaRange: 0.1 });
        return result;
    },
    /**
     * Artistic preprocessing - painterly smoothing
     * Good for: Stylized/artistic output
     */
    artistic: async (input) => {
        let result = await new KuwaharaFilter$3().apply(input, { radius: 4 });
        result = await new BilateralFilter$3().apply(result, { sigmaSpatial: 2, sigmaRange: 0.08 });
        return result;
    },
    /**
     * Photo preprocessing - for photos with grass/nature
     * Good for: Landscape, outdoor scenes
     */
    nature: async (input) => {
        // First pass: aggressive bilateral to smooth texture
        let result = await new BilateralFilter$3().apply(input, { sigmaSpatial: 6, sigmaRange: 0.15 });
        // Second pass: lighter bilateral to clean up
        result = await new BilateralFilter$3().apply(result, { sigmaSpatial: 3, sigmaRange: 0.08 });
        return result;
    },
};

var cpu = /*#__PURE__*/Object.freeze({
    __proto__: null,
    BilateralFilter: BilateralFilter$3,
    ContrastEnhancer: ContrastEnhancer$3,
    EdgeAwareFilterPresets: EdgeAwareFilterPresets,
    GaussianBlur: GaussianBlur$3,
    KuwaharaFilter: KuwaharaFilter$3,
    LocalVarianceFilter: LocalVarianceFilter,
    MedianFilter: MedianFilter$3,
    Quantizer: Quantizer$3
});

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/isotropic/shaders/webgpu-horizontal-blur.wgsl
// Regenerate with `npm run build:shaders`.
const source$C = `struct Params {
  width: u32,
  height: u32,
  kernelSize: u32,
  _pad: u32,
}

@group(0) @binding(0)
var<uniform> params: Params;

@group(0) @binding(1)
var<storage, read> kernel: array<f32>;

@group(0) @binding(2)
var<storage, read> input: array<f32>;

@group(0) @binding(3)
var<storage, read_write> output: array<f32>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let x = global_id.x;
  let y = global_id.y;
  
  if (x >= params.width || y >= params.height) {
    return;
  }
  
  let halfSize = i32(params.kernelSize) / 2;
  var sum = 0.0;
  
  for (var k = 0; k < i32(params.kernelSize); k = k + 1) {
    let sampleX = i32(x) + k - halfSize;
    let clampedX = clamp(sampleX, 0, i32(params.width) - 1);
    let sampleIdx = u32(clampedX) + y * params.width;
    sum = sum + input[sampleIdx] * kernel[u32(k)];
  }
  
  output[x + y * params.width] = sum;
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/isotropic/shaders/webgpu-vertical-blur.wgsl
// Regenerate with `npm run build:shaders`.
const source$B = `struct Params {
  width: u32,
  height: u32,
  kernelSize: u32,
  _pad: u32,
}

@group(0) @binding(0)
var<uniform> params: Params;

@group(0) @binding(1)
var<storage, read> kernel: array<f32>;

@group(0) @binding(2)
var<storage, read> input: array<f32>;

@group(0) @binding(3)
var<storage, read_write> output: array<f32>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let x = global_id.x;
  let y = global_id.y;
  
  if (x >= params.width || y >= params.height) {
    return;
  }
  
  let halfSize = i32(params.kernelSize) / 2;
  var sum = 0.0;
  
  for (var k = 0; k < i32(params.kernelSize); k = k + 1) {
    let sampleY = i32(y) + k - halfSize;
    let clampedY = clamp(sampleY, 0, i32(params.height) - 1);
    let sampleIdx = x + u32(clampedY) * params.width;
    sum = sum + input[sampleIdx] * kernel[u32(k)];
  }
  
  output[x + y * params.width] = sum;
}`;

/**
 * WebGPU-accelerated isotropic Gaussian blur
 * Uses compute shaders with separable convolution
 *
 * Supports concurrent/parallel blur calls by creating
 * separate staging buffers for each operation instead of reusing one.
 */
class WebGPUIsotropicFilter extends BaseWebGPUStrategy {
    resources = null;
    /**
     * Confirms an adapter is actually obtainable, not just that
     * `navigator.gpu` exists as an API surface.
     */
    static async isSupported() {
        return isWebGPUSupported();
    }
    /**
     * Initialize WebGPU resources
     */
    async initResources() {
        if (this.resources)
            return this.resources;
        const device = await WebGPUIsotropicFilter.getWebGPUDevice();
        if (!device) {
            throw new Error('WebGPU device not available');
        }
        // Create bind group layout
        const bindGroupLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        const pipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout],
        });
        // Create compute pipelines
        const horizontalPipeline = device.createComputePipeline({
            layout: pipelineLayout,
            compute: {
                module: device.createShaderModule({ code: source$C }),
                entryPoint: 'main',
            },
        });
        const verticalPipeline = device.createComputePipeline({
            layout: pipelineLayout,
            compute: {
                module: device.createShaderModule({ code: source$B }),
                entryPoint: 'main',
            },
        });
        return {
            device,
            horizontalPipeline,
            verticalPipeline,
            bindGroupLayout,
        };
    }
    /**
     * Fix for WebGPUIsotropicBlur: allocate buffers per call instead of
     * reusing instance-level ones, so concurrent blur() calls (as issued by
     * DoGProcessor.process()'s Promise.all([blur(sigma), blur(sigma*k)]))
     * never share mutable GPU state. Mirrors the pattern already used by
     * WebGPUFlowGuidedBlur and WebGPUGradientAlignedBlur.
     *
     * Delete the old paramsBuffer/kernelBuffer/inputBuffer/tempBuffer/
     * outputBuffer/currentBufferSize/currentKernelSize instance fields and
     * ensureBuffers() method; they're no longer needed.
     */
    async apply(input, config) {
        const cfg = { ...DEFAULT_ISOTROPIC_BLUR_CONFIG, ...config };
        const { sigma } = cfg;
        if (sigma < 0.1) {
            return {
                data: new Float32Array(input.data),
                width: input.width,
                height: input.height,
            };
        }
        const { device, horizontalPipeline, verticalPipeline, bindGroupLayout } = await this.initResources();
        const { width, height } = input;
        const pixelCount = width * height;
        const bufferSize = pixelCount * 4;
        const kernelSize = Math.min(cfg.maxKernelSize, Math.max(3, Math.floor(sigma * cfg.kernelSizeMultiplier) | 1));
        const kernel = generateGaussianKernel$1(sigma, kernelSize);
        // Per-call resources -- never shared with a concurrent blur() call on
        // this same instance.
        const paramsBuffer = device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const kernelBuffer = device.createBuffer({
            size: kernelSize * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        const inputBuffer = device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        const tempBuffer = device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        const outputBuffer = device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        const stagingBuffer = device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        try {
            device.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([width, height, kernelSize, 0]));
            device.queue.writeBuffer(kernelBuffer, 0, new Float32Array(kernel));
            device.queue.writeBuffer(inputBuffer, 0, new Float32Array(input.data));
            const horizontalBindGroup = device.createBindGroup({
                layout: bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: paramsBuffer } },
                    { binding: 1, resource: { buffer: kernelBuffer } },
                    { binding: 2, resource: { buffer: inputBuffer } },
                    { binding: 3, resource: { buffer: tempBuffer } },
                ],
            });
            const verticalBindGroup = device.createBindGroup({
                layout: bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: paramsBuffer } },
                    { binding: 1, resource: { buffer: kernelBuffer } },
                    { binding: 2, resource: { buffer: tempBuffer } },
                    { binding: 3, resource: { buffer: outputBuffer } },
                ],
            });
            const workgroupsX = Math.ceil(width / 16);
            const workgroupsY = Math.ceil(height / 16);
            const commandEncoder = device.createCommandEncoder();
            const horizontalPass = commandEncoder.beginComputePass();
            horizontalPass.setPipeline(horizontalPipeline);
            horizontalPass.setBindGroup(0, horizontalBindGroup);
            horizontalPass.dispatchWorkgroups(workgroupsX, workgroupsY);
            horizontalPass.end();
            const verticalPass = commandEncoder.beginComputePass();
            verticalPass.setPipeline(verticalPipeline);
            verticalPass.setBindGroup(0, verticalBindGroup);
            verticalPass.dispatchWorkgroups(workgroupsX, workgroupsY);
            verticalPass.end();
            commandEncoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, bufferSize);
            device.queue.submit([commandEncoder.finish()]);
            await stagingBuffer.mapAsync(GPUMapMode.READ);
            const resultData = new Float32Array(stagingBuffer.getMappedRange().slice(0));
            stagingBuffer.unmap();
            return { data: resultData, width, height };
        }
        finally {
            // Always release per-call resources, even if a pass or readback
            // throws, so concurrent/repeated calls don't leak GPU memory.
            paramsBuffer.destroy();
            kernelBuffer.destroy();
            inputBuffer.destroy();
            tempBuffer.destroy();
            outputBuffer.destroy();
            stagingBuffer.destroy();
        }
    }
    /**
     * dispose() no longer needs to clean up shared buffers -- only the
     * cached pipeline/layout resources from initResources() remain.
     */
    dispose() { }
}

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/isotropic/shaders/guassian-horizontal.glsl
// Regenerate with `npm run build:shaders`.
const source$A = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform float u_texelSizeX;
uniform int u_radius;
uniform float u_sigma2;

void main() {
  float sum = 0.0;
  float weightSum = 0.0;
  
  for (int dx = -u_radius; dx <= u_radius; dx++) {
    float offset = float(dx) * u_texelSizeX;
    float value = texture(u_image, v_texCoord + vec2(offset, 0.0)).r;
    
    float weight = exp(-float(dx * dx) / u_sigma2);
    sum += value * weight;
    weightSum += weight;
  }
  
  fragColor = vec4(sum / weightSum, 0.0, 0.0, 1.0);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: filters/isotropic/shaders/guassian-vertical.glsl
// Regenerate with `npm run build:shaders`.
const source$z = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform float u_texelSizeY;
uniform int u_radius;
uniform float u_sigma2;

void main() {
  float sum = 0.0;
  float weightSum = 0.0;
  
  for (int dy = -u_radius; dy <= u_radius; dy++) {
    float offset = float(dy) * u_texelSizeY;
    float value = texture(u_image, v_texCoord + vec2(0.0, offset)).r;
    
    float weight = exp(-float(dy * dy) / u_sigma2);
    sum += value * weight;
    weightSum += weight;
  }
  
  fragColor = vec4(sum / weightSum, 0.0, 0.0, 1.0);
}`;

/**
 * WebGL-Accelerated Preprocessing Module for XDoG/FDoG
 *
 * High-performance GPU implementations of image preprocessing filters.
 * Achieves 50-100x speedup over CPU implementations for large images.
 */
// ============================================================================
// WebGL Context Management
// ============================================================================
let gl$1 = null;
let canvas$1 = null;
// Shader program cache
const programCache$1 = new Map();
// Reusable geometry buffers
let quadVAO$1 = null;
/**
 * Check if running in a WebWorker context
 */
function isWorkerContext$1() {
    return typeof document === 'undefined';
}
/**
 * Initialize or get WebGL context
 */
function getGL$1() {
    if (gl$1)
        return gl$1;
    try {
        let glCanvas;
        // Use OffscreenCanvas in WebWorker, HTMLCanvasElement in main thread
        if (isWorkerContext$1()) {
            glCanvas = new OffscreenCanvas(1, 1);
        }
        else {
            glCanvas = document.createElement('canvas');
        }
        glCanvas.width = 1;
        glCanvas.height = 1;
        gl$1 = glCanvas.getContext('webgl2', {
            alpha: false,
            antialias: false,
            depth: false,
            stencil: false,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: false,
        });
        if (!gl$1) {
            console.warn('WebGL 2.0 not available');
            return null;
        }
        // Enable required extensions for float textures
        const ext1 = gl$1.getExtension('EXT_color_buffer_float');
        if (!ext1) {
            console.warn('EXT_color_buffer_float not available, some features may be limited');
        }
        canvas$1 = glCanvas;
        // Setup reusable quad geometry
        setupQuadGeometry$1();
        return gl$1;
    }
    catch (err) {
        console.error('WebGL initialization failed:', err);
        return null;
    }
}
/**
 * Setup fullscreen quad VAO (reused for all render passes)
 */
function setupQuadGeometry$1() {
    if (!gl$1)
        return;
    quadVAO$1 = gl$1.createVertexArray();
    gl$1.bindVertexArray(quadVAO$1);
    // Positions: fullscreen quad in clip space
    const positions = new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        1, 1,
    ]);
    // Texture coordinates
    const texCoords = new Float32Array([
        0, 0,
        1, 0,
        0, 1,
        1, 1,
    ]);
    const posBuffer = gl$1.createBuffer();
    gl$1.bindBuffer(gl$1.ARRAY_BUFFER, posBuffer);
    gl$1.bufferData(gl$1.ARRAY_BUFFER, positions, gl$1.STATIC_DRAW);
    gl$1.enableVertexAttribArray(0);
    gl$1.vertexAttribPointer(0, 2, gl$1.FLOAT, false, 0, 0);
    const texBuffer = gl$1.createBuffer();
    gl$1.bindBuffer(gl$1.ARRAY_BUFFER, texBuffer);
    gl$1.bufferData(gl$1.ARRAY_BUFFER, texCoords, gl$1.STATIC_DRAW);
    gl$1.enableVertexAttribArray(1);
    gl$1.vertexAttribPointer(1, 2, gl$1.FLOAT, false, 0, 0);
    gl$1.bindVertexArray(null);
}
// ============================================================================
// Shader Compilation Utilities
// ============================================================================
const VERTEX_SHADER$1 = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;
out vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;
function compileShader$3(source, type) {
    if (!gl$1)
        return null;
    const shader = gl$1.createShader(type);
    if (!shader)
        return null;
    gl$1.shaderSource(shader, source);
    gl$1.compileShader(shader);
    if (!gl$1.getShaderParameter(shader, gl$1.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl$1.getShaderInfoLog(shader));
        gl$1.deleteShader(shader);
        return null;
    }
    return shader;
}
function createProgram$4(fragmentSource, cacheKey) {
    if (!gl$1)
        return null;
    // Check cache first
    const cached = programCache$1.get(cacheKey);
    if (cached)
        return cached;
    const vertShader = compileShader$3(VERTEX_SHADER$1, gl$1.VERTEX_SHADER);
    const fragShader = compileShader$3(fragmentSource, gl$1.FRAGMENT_SHADER);
    if (!vertShader || !fragShader)
        return null;
    const program = gl$1.createProgram();
    if (!program)
        return null;
    gl$1.attachShader(program, vertShader);
    gl$1.attachShader(program, fragShader);
    gl$1.linkProgram(program);
    if (!gl$1.getProgramParameter(program, gl$1.LINK_STATUS)) {
        console.error('Program link error:', gl$1.getProgramInfoLog(program));
        gl$1.deleteProgram(program);
        return null;
    }
    // Cleanup shaders (they're now part of the program)
    gl$1.deleteShader(vertShader);
    gl$1.deleteShader(fragShader);
    // Cache the program
    programCache$1.set(cacheKey, program);
    return program;
}
// ============================================================================
// Texture and Framebuffer Utilities
// ============================================================================
function createInputTexture$1(data, width, height) {
    if (!gl$1)
        return null;
    const texture = gl$1.createTexture();
    gl$1.bindTexture(gl$1.TEXTURE_2D, texture);
    // Upload grayscale data as R32F
    gl$1.texImage2D(gl$1.TEXTURE_2D, 0, gl$1.R32F, width, height, 0, gl$1.RED, gl$1.FLOAT, data);
    gl$1.texParameteri(gl$1.TEXTURE_2D, gl$1.TEXTURE_WRAP_S, gl$1.CLAMP_TO_EDGE);
    gl$1.texParameteri(gl$1.TEXTURE_2D, gl$1.TEXTURE_WRAP_T, gl$1.CLAMP_TO_EDGE);
    gl$1.texParameteri(gl$1.TEXTURE_2D, gl$1.TEXTURE_MIN_FILTER, gl$1.NEAREST);
    gl$1.texParameteri(gl$1.TEXTURE_2D, gl$1.TEXTURE_MAG_FILTER, gl$1.NEAREST);
    return texture;
}
function createFramebuffer$2(width, height) {
    if (!gl$1)
        return null;
    const fb = gl$1.createFramebuffer();
    const tex = gl$1.createTexture();
    if (!fb || !tex)
        return null;
    gl$1.bindTexture(gl$1.TEXTURE_2D, tex);
    gl$1.texImage2D(gl$1.TEXTURE_2D, 0, gl$1.RGBA32F, width, height, 0, gl$1.RGBA, gl$1.FLOAT, null);
    gl$1.texParameteri(gl$1.TEXTURE_2D, gl$1.TEXTURE_WRAP_S, gl$1.CLAMP_TO_EDGE);
    gl$1.texParameteri(gl$1.TEXTURE_2D, gl$1.TEXTURE_WRAP_T, gl$1.CLAMP_TO_EDGE);
    gl$1.texParameteri(gl$1.TEXTURE_2D, gl$1.TEXTURE_MIN_FILTER, gl$1.NEAREST);
    gl$1.texParameteri(gl$1.TEXTURE_2D, gl$1.TEXTURE_MAG_FILTER, gl$1.NEAREST);
    gl$1.bindFramebuffer(gl$1.FRAMEBUFFER, fb);
    gl$1.framebufferTexture2D(gl$1.FRAMEBUFFER, gl$1.COLOR_ATTACHMENT0, gl$1.TEXTURE_2D, tex, 0);
    const status = gl$1.checkFramebufferStatus(gl$1.FRAMEBUFFER);
    if (status !== gl$1.FRAMEBUFFER_COMPLETE) {
        console.error('Framebuffer incomplete:', status);
        gl$1.deleteFramebuffer(fb);
        gl$1.deleteTexture(tex);
        return null;
    }
    gl$1.bindFramebuffer(gl$1.FRAMEBUFFER, null);
    return { fb, tex };
}
function readResult$1(fb, width, height) {
    if (!gl$1)
        return new Float32Array(0);
    gl$1.bindFramebuffer(gl$1.FRAMEBUFFER, fb);
    const pixels = new Float32Array(width * height * 4);
    gl$1.readPixels(0, 0, width, height, gl$1.RGBA, gl$1.FLOAT, pixels);
    // Extract red channel only
    const result = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        result[i] = pixels[i * 4];
    }
    gl$1.bindFramebuffer(gl$1.FRAMEBUFFER, null);
    return result;
}
function renderPass$1(program, inputTex, outputFb, width, height, uniforms) {
    if (!gl$1 || !quadVAO$1)
        return;
    gl$1.useProgram(program);
    gl$1.bindFramebuffer(gl$1.FRAMEBUFFER, outputFb);
    gl$1.viewport(0, 0, width, height);
    // Bind input texture
    gl$1.activeTexture(gl$1.TEXTURE0);
    gl$1.bindTexture(gl$1.TEXTURE_2D, inputTex);
    gl$1.uniform1i(gl$1.getUniformLocation(program, 'u_image'), 0);
    // Set uniforms
    for (const [name, value] of Object.entries(uniforms)) {
        const loc = gl$1.getUniformLocation(program, name);
        if (loc === null)
            continue;
        if (Array.isArray(value)) {
            if (value.length === 2)
                gl$1.uniform2fv(loc, value);
            else if (value.length === 3)
                gl$1.uniform3fv(loc, value);
            else if (value.length === 4)
                gl$1.uniform4fv(loc, value);
        }
        else if (Number.isInteger(value)) {
            gl$1.uniform1i(loc, value);
        }
        else {
            gl$1.uniform1f(loc, value);
        }
    }
    // Draw
    gl$1.bindVertexArray(quadVAO$1);
    gl$1.drawArrays(gl$1.TRIANGLE_STRIP, 0, 4);
    gl$1.bindVertexArray(null);
}
// ============================================================================
// Isometric BLUR - Separable WebGL Implementation (Very Fast)
// ============================================================================
class WebGLIsotropicFilter extends BaseWebGLStrategy {
    static async isSupported() {
        return isWebGLAvailable$1();
    }
    static async getUnsupportedReason() {
        return isWebGLAvailable$1() ? undefined : 'WebGL 2.0 is not available in this environment';
    }
    async apply(input, config) {
        const sigma = config.sigma ?? DEFAULT_GAUSSIAN_CONFIG.sigma;
        if (sigma < 0.1) {
            return { data: new Float32Array(input.data), width: input.width, height: input.height };
        }
        const gl = getGL$1();
        if (!gl) {
            throw new Error('GaussianBlurWebGL: WebGL 2.0 is not available in this environment.');
        }
        const { width, height, data } = input;
        const radius = Math.ceil(sigma * 3);
        const sigma2 = 2.0 * sigma * sigma;
        if (canvas$1.width !== width || canvas$1.height !== height) {
            canvas$1.width = width;
            canvas$1.height = height;
        }
        return this.runGuarded(gl, () => {
            const hProgram = createProgram$4(source$A, 'gaussianH');
            const vProgram = createProgram$4(source$z, 'gaussianV');
            if (!hProgram || !vProgram) {
                throw new Error('GaussianBlurWebGL: failed to compile/link shader program.');
            }
            const inputTex = createInputTexture$1(data, width, height);
            const tempFb = createFramebuffer$2(width, height);
            const outputFb = createFramebuffer$2(width, height);
            if (!inputTex || !tempFb || !outputFb) {
                if (inputTex)
                    gl.deleteTexture(inputTex);
                if (tempFb) {
                    gl.deleteFramebuffer(tempFb.fb);
                    gl.deleteTexture(tempFb.tex);
                }
                throw new Error('GaussianBlurWebGL: failed to create input texture or framebuffer.');
            }
            // Horizontal pass
            renderPass$1(hProgram, inputTex, tempFb.fb, width, height, {
                u_texelSizeX: 1.0 / width,
                u_radius: radius,
                u_sigma2: sigma2,
            });
            // Vertical pass
            renderPass$1(vProgram, tempFb.tex, outputFb.fb, width, height, {
                u_texelSizeY: 1.0 / height,
                u_radius: radius,
                u_sigma2: sigma2,
            });
            const result = readResult$1(outputFb.fb, width, height);
            // Cleanup
            gl.deleteTexture(inputTex);
            gl.deleteTexture(tempFb.tex);
            gl.deleteFramebuffer(tempFb.fb);
            gl.deleteTexture(outputFb.tex);
            gl.deleteFramebuffer(outputFb.fb);
            return { data: result, width, height };
        });
    }
}
// ============================================================================
// UTILITY EXPORTS
// ============================================================================
/**
 * Check if WebGL 2.0 is available
 */
function isWebGLAvailable$1() {
    return getGL$1() !== null;
}

/**
 * Blur strategies for DoG processing
 *
 * Provides both isotropic (standard) and anisotropic (flow-guided) blur
 * implementations for use in XDoG and FDoG pipelines.
 *
 * Supports parallel/concurrent blur operations
 */
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
class CPUIsotropicFilter extends BaseCPUStrategy {
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
        const kernel = generateGaussianKernel$1(sigma, kernelSize);
        const halfKernel = Math.floor(kernelSize / 2);
        // Separable convolution: horizontal pass
        const temp = createChannelImage$1(input.width, input.height);
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
        const output = createChannelImage$1(input.width, input.height);
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

/**
 * Composed Preprocessing Module for XDoG/FDoG
 *
 * This module is the single entry point the rest of the codebase should
 * import from. Each exported class resolves its OWN best-supported
 * backend independently (WebGPU > WebGL > CPU), the first time it's
 * created:
 *
 *   BilateralFilter.create(...)  // may end up WebGPU on this device
 *   MedianFilter.create(...)     // may end up WebGL on this device, if
 *                                // e.g. it needs a storage texture format
 *                                // WebGPU can't provide here
 *
 * A device can support WebGPU for one algorithm and not another, so
 * resolution happens per class, not once globally for the whole module.
 * This follows the same pattern used for BlurStrategy/ETFComputer.
 *
 * If a backend fails mid-session (driver crash, lost context), each
 * instance demotes itself to the next supported candidate once and
 * retries the call that failed; that shared retry/demote machinery lives
 * in `ResilientEdgeAwareFilter`, not duplicated per filter.
 */
function pickCandidates$1(candidates, options) {
    if (!options?.forceCPU)
        return candidates;
    return [candidates[candidates.length - 1]];
}
/**
 * Edge-preserving smoothing filter. Resolves the best supported backend
 * at creation time; falls back once if that backend fails later.
 */
let BilateralFilter$2 = class BilateralFilter extends ResilientEdgeAwareFilter {
    // Ordered best-to-worst. `satisfies` (not `implements`) catches a
    // backend missing isSupported() or the instance shape at this line.
    static candidates = [
        GPUBilateralFilter$1,
        BilateralFilterWebGL$1,
        BilateralFilter$3,
    ];
    constructor(resolved, config) {
        super(BilateralFilter.candidates, resolved, config);
    }
    static async create(config = {}, options) {
        const resolved = await ResilientEdgeAwareFilter.resolve(pickCandidates$1(BilateralFilter.candidates, options), config);
        return new BilateralFilter(resolved, config);
    }
};
/**
 * Median filter for salt-and-pepper noise removal.
 */
let MedianFilter$2 = class MedianFilter extends ResilientEdgeAwareFilter {
    static candidates = [
        GPUMedianFilter$1,
        MedianFilterWebGL$1,
        MedianFilter$3,
    ];
    constructor(resolved, config) {
        super(MedianFilter.candidates, resolved, config);
    }
    static async create(config = {}, options) {
        const resolved = await ResilientEdgeAwareFilter.resolve(pickCandidates$1(MedianFilter.candidates, options), config);
        return new MedianFilter(resolved, config);
    }
};
/**
 * Kuwahara filter for a painterly, stylized effect.
 */
let KuwaharaFilter$2 = class KuwaharaFilter extends ResilientEdgeAwareFilter {
    static candidates = [
        GPUKuwaharaFilter$1,
        KuwaharaFilterWebGL$1,
        KuwaharaFilter$3,
    ];
    constructor(resolved, config) {
        super(KuwaharaFilter.candidates, resolved, config);
    }
    static async create(config = {}, options) {
        const resolved = await ResilientEdgeAwareFilter.resolve(pickCandidates$1(KuwaharaFilter.candidates, options), config);
        return new KuwaharaFilter(resolved, config);
    }
};
/**
 * Separable Isotropic blur.
 */
class IsotropicBlurFilter extends ResilientEdgeAwareFilter {
    static candidates = [
        WebGPUIsotropicFilter,
        WebGLIsotropicFilter,
        CPUIsotropicFilter,
    ];
    constructor(resolved, config) {
        super(IsotropicBlurFilter.candidates, resolved, config);
    }
    static async create(config, options) {
        const resolved = await ResilientEdgeAwareFilter.resolve(pickCandidates$1(IsotropicBlurFilter.candidates, options), config);
        return new IsotropicBlurFilter(resolved, config);
    }
}
/**
 * Separable Gaussian blur.
 */
let GaussianBlur$2 = class GaussianBlur extends ResilientEdgeAwareFilter {
    static candidates = [
        GPUGaussianBlur$1,
        GaussianBlurWebGL$1,
        GaussianBlur$3,
    ];
    constructor(resolved, config) {
        super(GaussianBlur.candidates, resolved, config);
    }
    static async create(config, options) {
        const resolved = await ResilientEdgeAwareFilter.resolve(pickCandidates$1(GaussianBlur.candidates, options), config);
        return new GaussianBlur(resolved, config);
    }
};
let ContrastEnhancer$2 = class ContrastEnhancer extends ResilientEdgeAwareFilter {
    static candidates = [
        GPUContrastEnhancer$1,
        ContrastEnhancerWebGL$1,
        ContrastEnhancer$3,
    ];
    constructor(resolved, config) {
        super(ContrastEnhancer.candidates, resolved, config);
    }
    static async create(blackPoint = 0.01, whitePoint = 0.99, options) {
        const config = { blackPoint, whitePoint };
        const resolved = await ResilientEdgeAwareFilter.resolve(pickCandidates$1(ContrastEnhancer.candidates, options), config);
        return new ContrastEnhancer(resolved, config);
    }
};
/**
 * Posterize/quantize intensity levels.
 */
let Quantizer$2 = class Quantizer extends ResilientEdgeAwareFilter {
    static candidates = [
        GPUQuantizer$1,
        QuantizerWebGL$1,
        Quantizer$3,
    ];
    constructor(resolved, config) {
        super(Quantizer.candidates, resolved, config);
    }
    static async create(config, options) {
        const resolved = await ResilientEdgeAwareFilter.resolve(pickCandidates$1(Quantizer.candidates, options), config);
        return new Quantizer(resolved, config);
    }
};
const PreprocessingPresets$1 = {
    /**
     * Light preprocessing - minimal smoothing
     * Good for: Clean studio photos, illustrations
     */
    light: async (input) => {
        const filter = await BilateralFilter$2.create();
        try {
            return await filter.apply(input, { sigmaSpatial: 2, sigmaRange: 0.08 });
        }
        finally {
            filter.dispose();
        }
    },
    /**
     * Standard preprocessing - balanced smoothing
     * Good for: Most outdoor photos, portraits
     */
    standard: async (input) => {
        const filter = await BilateralFilter$2.create();
        try {
            return await filter.apply(input, { sigmaSpatial: 4, sigmaRange: 0.1 });
        }
        finally {
            filter.dispose();
        }
    },
    /**
     * Heavy preprocessing - aggressive noise removal
     * Good for: Very textured images (grass, foliage, fabric)
     */
    heavy: async (input) => {
        const first = await BilateralFilter$2.create();
        const second = await BilateralFilter$2.create();
        try {
            return await second.apply(await first.apply(input, { sigmaSpatial: 5, sigmaRange: 0.12 }), { sigmaSpatial: 3, sigmaRange: 0.1 });
        }
        finally {
            first.dispose();
            second.dispose();
        }
    },
    /**
     * Artistic preprocessing - painterly smoothing
     * Good for: Stylized/artistic output
     */
    artistic: async (input) => {
        const kuwahara = await KuwaharaFilter$2.create();
        const bilateral = await BilateralFilter$2.create();
        try {
            return await bilateral.apply(await kuwahara.apply(input, { radius: 4 }), { sigmaSpatial: 2, sigmaRange: 0.08 });
        }
        finally {
            kuwahara.dispose();
            bilateral.dispose();
        }
    },
    /**
     * Photo preprocessing - for photos with grass/nature
     * Good for: Landscape, outdoor scenes
     */
    nature: async (input) => {
        const first = await BilateralFilter$2.create();
        const second = await BilateralFilter$2.create();
        try {
            return await second.apply(await first.apply(input, { sigmaSpatial: 6, sigmaRange: 0.15 }), { sigmaSpatial: 3, sigmaRange: 0.08 });
        }
        finally {
            first.dispose();
            second.dispose();
        }
    },
};

/**
 * Blur strategies for DoG processing
 *
 * Provides both isotropic (standard) and anisotropic (flow-guided) blur
 * implementations for use in XDoG and FDoG pipelines.
 *
 * Supports parallel/concurrent blur operations
 */
/**
 * Backend-agnostic isotropic blur. Picks the best backend this device
 * actually supports for *this algorithm* (not a global session-wide
 * choice), and falls back to the next-best backend if the active one
 * fails mid-session (lost context, driver crash, etc.).
 *
 * Construction is async (`IsotropicBlur.create()`) because backend
 * detection is inherently async; constructors can't be async, so a
 * private constructor plus a static factory forces detection to
 * complete before the instance is usable.
 */
class IsotropicBlur {
    filter;
    constructor(filter) {
        this.filter = filter;
    }
    static async create(config = {}) {
        return new IsotropicBlur(await IsotropicBlurFilter.create(config));
    }
    get backend() {
        return this.filter.backend;
    }
    dispose() {
        this.filter.dispose();
    }
    async blur(input, sigma) {
        return this.filter.apply(input, { sigma });
    }
}

/**
 * High-level XDoG implementation
 *
 * This class provides a convenient wrapper that compose the blur strategies
 * and DoG processor together.
 *
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 */
/**
 * XDoG (Extended Difference of Gaussians)
 *
 * Uses standard isotropic Gaussian blur for edge detection and stylization.
 * Good for general-purpose edge detection and artistic effects.
 *
 * This implements the reparameterized XDoG from Section 2.5 of the paper,
 * using Equation 7 for the sharpening computation.
 */
class XDoG {
    config;
    dogConfig;
    blurStrategyPromise;
    constructor(config = {}) {
        const { kernelSizeMultiplier, blurStrategy, ...dogConfig } = config;
        this.config = { ...DEFAULT_DOG_CONFIG, kernelSizeMultiplier: 6, ...config };
        this.dogConfig = dogConfig;
        // Not awaited here — just started. Anything that needs the resolved
        // strategy (process*(), dispose()) awaits this promise itself.
        this.blurStrategyPromise = Promise.resolve(blurStrategy ??
            IsotropicBlur.create({ kernelSizeMultiplier: this.config.kernelSizeMultiplier }));
    }
    dispose() {
        this.blurStrategyPromise.then((strategy) => strategy.dispose()).catch(() => { });
    }
    /**
     * Create XDoG with a preset style
     */
    static withPreset(presetName) {
        return new XDoG(STYLE_PRESETS[presetName]);
    }
    async getProcessor() {
        const strategy = await this.blurStrategyPromise;
        return new DoGProcessor(strategy, this.dogConfig);
    }
    /**
     * Process a grayscale image
     */
    async process(input, overrides = {}) {
        const processor = await this.getProcessor();
        try {
            return await processor.process(input, overrides);
        }
        finally {
            processor.dispose();
        }
    }
    /**
     * Process without thresholding (returns sharpened image)
     */
    async processSharpened(input, overrides = {}) {
        const processor = await this.getProcessor();
        try {
            return await processor.processNoThreshold(input, overrides);
        }
        finally {
            processor.dispose();
        }
    }
    /**
     * Get raw DoG response for visualization
     */
    async processRawDoG(input, overrides = {}) {
        const processor = await this.getProcessor();
        try {
            return await processor.processRawDoG(input, overrides);
        }
        finally {
            processor.dispose();
        }
    }
    /**
     * Process and return all intermediate results
     *
     * This is more efficient than calling process(), processSharpened(), and
     * processRawDoG() separately as it only performs the blur operations once.
     *
     * Useful for:
     * - Hatching strategies that need the sharpened image
     * - Debugging and visualization
     * - Custom post-processing pipelines
     */
    async processDetailed(input, overrides = {}) {
        const processor = await this.getProcessor();
        try {
            return await processor.processDetailed(input, overrides);
        }
        finally {
            processor.dispose();
        }
    }
    /**
     * Convenience method to process ImageData directly (e.g., from a canvas)
     */
    async processGrayscaleImageData(input, overrides = {}) {
        const grayscale = imageDataToLuminance(input);
        const result = await this.process(grayscale, overrides);
        return luminanceToImageData(result);
    }
    /**
     * Get current configuration.
     */
    getConfig() {
        return { ...this.config, ...this.dogConfig };
    }
    setConfig(config) {
        const { kernelSizeMultiplier, blurStrategy, ...dogConfig } = config;
        this.config = { ...this.config, ...config };
        this.dogConfig = { ...this.dogConfig, ...dogConfig };
        if (blurStrategy !== undefined) {
            const oldStrategyPromise = this.blurStrategyPromise;
            this.blurStrategyPromise = Promise.resolve(blurStrategy);
            oldStrategyPromise.then((s) => s.dispose()).catch(() => { });
        }
        else if (kernelSizeMultiplier !== undefined) {
            const oldStrategyPromise = this.blurStrategyPromise;
            this.blurStrategyPromise = IsotropicBlur.create({ kernelSizeMultiplier });
            oldStrategyPromise.then((s) => s.dispose()).catch(() => { });
        }
    }
}
/**
 * Convenience function for one-shot XDoG processing
 */
async function xdog(input, config = {}) {
    const processor = new XDoG(config);
    const result = await processor.process(input);
    processor.dispose();
    return result;
}

/**
 * Shared FlowField result type for Edge Tangent Flow backends.
 */
class TangentFlowField {
    tangents;
    width;
    height;
    magnitude;
    anisotropy;
    // Flat, stride-2 (x, y) buffer which avoids allocating pixelCount JS
    // objects regardless of which backend produced the data.
    //
    // magnitude/anisotropy are flat, stride-1 (one value per pixel) buffers,
    // both optional so that callers who genuinely have no confidence data
    // (e.g. a hand-authored or interpolated flow field) can omit them rather
    // than fabricate zeros; missing values read back as 0, which is the
    // conservative "trust nothing" default for confidence-weighted consumers.
    constructor(tangents, width, height, magnitude, anisotropy) {
        this.tangents = tangents;
        this.width = width;
        this.height = height;
        this.magnitude = magnitude;
        this.anisotropy = anisotropy;
    }
    static fromFloat32Array(tangents, width, height, magnitude, anisotropy) {
        return new TangentFlowField(tangents, width, height, magnitude, anisotropy);
    }
    static fromVec2Array(tangents, width, height, magnitude, anisotropy) {
        const flat = new Float32Array(tangents.length * 2);
        for (let i = 0; i < tangents.length; i++) {
            flat[i * 2] = tangents[i].x;
            flat[i * 2 + 1] = tangents[i].y;
        }
        return new TangentFlowField(flat, width, height, magnitude, anisotropy);
    }
    getTangent(x, y) {
        const clampedX = Math.max(0, Math.min(this.width - 1, Math.round(x)));
        const clampedY = Math.max(0, Math.min(this.height - 1, Math.round(y)));
        const idx = (clampedY * this.width + clampedX) * 2;
        return { x: this.tangents[idx], y: this.tangents[idx + 1] };
    }
    getTangentArray() {
        return this.tangents.slice();
    }
    clampedIndex(x, y) {
        const clampedX = Math.max(0, Math.min(this.width - 1, Math.round(x)));
        const clampedY = Math.max(0, Math.min(this.height - 1, Math.round(y)));
        return clampedY * this.width + clampedX;
    }
    getMagnitude(x, y) {
        if (!this.magnitude)
            return 0;
        return this.magnitude[this.clampedIndex(x, y)];
    }
    getAnisotropy(x, y) {
        if (!this.anisotropy)
            return 0;
        return this.anisotropy[this.clampedIndex(x, y)];
    }
    /**
     * Visualize the flow field as a grayscale image.
     * Encodes direction as intensity (useful for debugging).
     */
    visualize() {
        const output = createChannelImage$1(this.width, this.height);
        for (let i = 0; i < this.width * this.height; i++) {
            const tx = this.tangents[i * 2];
            const ty = this.tangents[i * 2 + 1];
            const angle = Math.atan2(ty, tx);
            output.data[i] = (angle + Math.PI) / (2 * Math.PI);
        }
        return output;
    }
    /**
     * Visualize as a color image (HSV with direction as hue).
     */
    visualizeColor() {
        const imageData = new ImageData(this.width, this.height);
        for (let i = 0; i < this.width * this.height; i++) {
            const tx = this.tangents[i * 2];
            const ty = this.tangents[i * 2 + 1];
            // Direction as hue
            const angle = Math.atan2(ty, tx);
            const hue = (angle + Math.PI) / (2 * Math.PI);
            // Magnitude as saturation/value (always 1 for normalized vectors)
            const [r, g, b] = hsvToRgb$1(hue, 1, 1);
            const o = i * 4;
            imageData.data[o] = r;
            imageData.data[o + 1] = g;
            imageData.data[o + 2] = b;
            imageData.data[o + 3] = 255;
        }
        return imageData;
    }
}
/**
 * Convert HSV to RGB. Only used by visualizeColor() above.
 */
function hsvToRgb$1(h, s, v) {
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

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgpu/common.wgsl
// Regenerate with `npm run build:shaders`.
const source$y = `// common.wgsl
// Pipeline-overridable. real value supplied via
// GPUComputePipelineDescriptor.compute.constants (see makePipeline() in
// webgpu.ts). Declared once here since it's shared by every shader module.
override WORKGROUP_SIZE: u32 = 8u;

struct Params {
  width: u32,
  height: u32,
  radius: u32,
  kernelSize: u32,
};

fn clampIdx(x: i32, y: i32, w: i32, h: i32) -> u32 {
  let cx = clamp(x, 0, w - 1);
  let cy = clamp(y, 0, h - 1);
  return u32(cy * w + cx);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgpu/gradient_structure_tensor.wgsl
// Regenerate with `npm run build:shaders`.
const source$x = `// Fused Sobel gradient + structure-tensor accumulation.
//
// Replaces the old gradient.wgsl -> structure_tensor_accumulate.wgsl pair.
// Nothing downstream ever consumed the raw gradient (gx, gy) on its own —
// the only thing that read gradBuf was the tensor-accumulate pass, which
// immediately squared/multiplied it away — so materializing it as a
// separate full-image vec4<f32> buffer was a full extra write + read of
// image-sized data (and a whole dispatch) for no benefit. This shader
// computes the Sobel gradient and folds it directly into the running
// structure-tensor sum in one pass.
//
// Still an *accumulate* (read-modify-write add), exactly like the old
// structure_tensor_accumulate.wgsl: for Di Zenzo multichannel summation,
// this is dispatched once per input channel with accumBuf zeroed first
// (see encoder.clearBuffer() in webgpu.ts), and each channel's E/F/G is
// summed in rather than overwriting.
//
// .w (magnitude) is deliberately left untouched here, for the same reason
// as before: summing each channel's own sqrt(e+g) would be wrong since
// sqrt is nonlinear. Magnitude is now derived directly from the final
// accumulated trace inside tangent_extract.wgsl instead of a separate
// finalize-magnitude pass.

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputBuf: array<f32>;
@group(0) @binding(2) var<storage, read_write> accumBuf: array<vec4<f32>>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = i32(params.width);
  let h = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  // Sobel operator
  let p00 = inputBuf[clampIdx(x - 1, y - 1, w, h)];
  let p10 = inputBuf[clampIdx(x,     y - 1, w, h)];
  let p20 = inputBuf[clampIdx(x + 1, y - 1, w, h)];
  let p01 = inputBuf[clampIdx(x - 1, y,     w, h)];
  let p21 = inputBuf[clampIdx(x + 1, y,     w, h)];
  let p02 = inputBuf[clampIdx(x - 1, y + 1, w, h)];
  let p12 = inputBuf[clampIdx(x,     y + 1, w, h)];
  let p22 = inputBuf[clampIdx(x + 1, y + 1, w, h)];

  let gx = -p00 + p20 - 2.0 * p01 + 2.0 * p21 - p02 + p22;
  let gy = -p00 - 2.0 * p10 - p20 + p02 + 2.0 * p12 + p22;

  // Structure tensor: E=gx^2, F=gx*gy, G=gy^2
  let e = gx * gx;
  let f = gx * gy;
  let g = gy * gy;

  let idx = u32(y * w + x);
  accumBuf[idx] = accumBuf[idx] + vec4<f32>(e, f, g, 0.0);
}
`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgpu/gaussian_blur.wgsl
// Regenerate with `npm run build:shaders`.
const source$w = `@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputBuf: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outputBuf: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> kernelBuf: array<f32>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn blurH(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = i32(params.width);
  let h = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let radius = i32(params.radius);
  let kernelSize = i32(params.kernelSize);
  var sum = vec4<f32>(0.0);

  for (var i = 0; i < kernelSize; i = i + 1) {
    let sx = x + (i - radius);
    sum = sum + inputBuf[clampIdx(sx, y, w, h)] * kernelBuf[i];
  }

  outputBuf[u32(y * w + x)] = sum;
}

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn blurV(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = i32(params.width);
  let h = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let radius = i32(params.radius);
  let kernelSize = i32(params.kernelSize);
  var sum = vec4<f32>(0.0);

  for (var i = 0; i < kernelSize; i = i + 1) {
    let sy = y + (i - radius);
    sum = sum + inputBuf[clampIdx(x, sy, w, h)] * kernelBuf[i];
  }

  outputBuf[u32(y * w + x)] = sum;
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgpu/gaussian_blur_tiled.wgsl
// Regenerate with `npm run build:shaders`.
const source$v = `override TILE_RADIUS_CAP: u32 = 32u;
override TILE_WIDTH: u32 = WORKGROUP_SIZE + 2u * TILE_RADIUS_CAP;
override KERNEL_SHARED_SIZE: u32 = 2u * TILE_RADIUS_CAP + 1u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputBuf: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outputBuf: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> kernelBuf: array<f32>;

// Sized for the worst-case radius this tiled path supports (TILE_RADIUS_CAP);
// actual radius at dispatch time is always <= that, so only a prefix of
// these arrays is used per call.
var<workgroup> tileRow: array<vec4<f32>, TILE_WIDTH * WORKGROUP_SIZE>;
var<workgroup> kernelShared: array<f32, KERNEL_SHARED_SIZE>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn blurHTiled(
  @builtin(local_invocation_id) lid: vec3<u32>,
  @builtin(workgroup_id) wgid: vec3<u32>
) {
  let w = i32(params.width);
  let h = i32(params.height);
  let radius = i32(params.radius);
  let kernelSize = i32(params.kernelSize);

  let localX = i32(lid.x);
  let localY = i32(lid.y);
  let flatLocal = localY * i32(WORKGROUP_SIZE) + localX;
  let wgOriginX = i32(wgid.x) * i32(WORKGROUP_SIZE);
  let wgOriginY = i32(wgid.y) * i32(WORKGROUP_SIZE);
  let tileWidth = i32(WORKGROUP_SIZE) + 2 * radius;

  var loadIdx = flatLocal;
  loop {
    if (loadIdx >= kernelSize) { break; }
    kernelShared[loadIdx] = kernelBuf[loadIdx];
    loadIdx = loadIdx + i32(WORKGROUP_SIZE * WORKGROUP_SIZE);
  }

  let y = wgOriginY + localY;
  var col = localX;
  loop {
    if (col >= tileWidth) { break; }
    let sx = wgOriginX + col - radius;
    tileRow[localY * i32(TILE_WIDTH) + col] = inputBuf[clampIdx(sx, y, w, h)];
    col = col + i32(WORKGROUP_SIZE);
  }

  workgroupBarrier();

  let x = wgOriginX + localX;
  if (x >= w || y >= h) { return; }

  var sum = vec4<f32>(0.0);
  for (var i = 0; i < kernelSize; i = i + 1) {
    sum = sum + tileRow[localY * i32(TILE_WIDTH) + localX + i] * kernelShared[i];
  }

  outputBuf[u32(y * w + x)] = sum;
}

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn blurVTiled(
  @builtin(local_invocation_id) lid: vec3<u32>,
  @builtin(workgroup_id) wgid: vec3<u32>
) {
  let w = i32(params.width);
  let h = i32(params.height);
  let radius = i32(params.radius);
  let kernelSize = i32(params.kernelSize);

  let localX = i32(lid.x);
  let localY = i32(lid.y);
  let flatLocal = localY * i32(WORKGROUP_SIZE) + localX;
  let wgOriginX = i32(wgid.x) * i32(WORKGROUP_SIZE);
  let wgOriginY = i32(wgid.y) * i32(WORKGROUP_SIZE);
  let tileHeight = i32(WORKGROUP_SIZE) + 2 * radius;

  var loadIdx = flatLocal;
  loop {
    if (loadIdx >= kernelSize) { break; }
    kernelShared[loadIdx] = kernelBuf[loadIdx];
    loadIdx = loadIdx + i32(WORKGROUP_SIZE * WORKGROUP_SIZE);
  }

  let x = wgOriginX + localX;
  var row = localY;
  loop {
    if (row >= tileHeight) { break; }
    let sy = wgOriginY + row - radius;
    tileRow[row * i32(WORKGROUP_SIZE) + localX] = inputBuf[clampIdx(x, sy, w, h)];
    row = row + i32(WORKGROUP_SIZE);
  }

  workgroupBarrier();

  let y = wgOriginY + localY;
  if (x >= w || y >= h) { return; }

  var sum = vec4<f32>(0.0);
  for (var i = 0; i < kernelSize; i = i + 1) {
    sum = sum + tileRow[(localY + i) * i32(WORKGROUP_SIZE) + localX] * kernelShared[i];
  }

  outputBuf[u32(y * w + x)] = sum;
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgpu/tangent_extract.wgsl
// Regenerate with `npm run build:shaders`.
const source$u = `@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> tensorBuf: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outputBuf: array<vec4<f32>>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = i32(params.width);
  let h = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let idx = u32(y * w + x);
  let tensor = tensorBuf[idx];
  let e = tensor.x;
  let f = tensor.y;
  let g = tensor.z;
  // .w is unused: the upstream gradient/structure-tensor pass no longer
  // precomputes magnitude in a separate finalize pass. It's derived
  // directly from the trace below instead — sqrt(E+G) == hypot(gx, gy)
  // for the single-channel case, and is the Di Zenzo-consistent combined
  // magnitude for the multichannel case (see gradient_structure_tensor.wgsl).
  let trace = e + g;
  let mag = sqrt(max(trace, 0.0));

  // Eigenvector for smallest eigenvalue
  let diff = e - g;
  let disc = sqrt(diff * diff + 4.0 * f * f);

  var tangent = vec2<f32>(0.0, 1.0);

  if (abs(f) > 1e-10) {
    let lambda1 = (e + g - disc) * 0.5;
    tangent = vec2<f32>(lambda1 - g, f);
  } else if (e < g) {
    tangent = vec2<f32>(1.0, 0.0);
  } else {
    tangent = vec2<f32>(0.0, 1.0);
  }

  let len = length(tangent);
  if (len > 1e-10) {
    tangent = tangent / len;
  }

  // Anisotropy: (lambda1-lambda2)/(lambda1+lambda2) = disc/trace. \`disc\`
  // is already computed above for the eigenvector; \`trace\` above for mag.
  let anisotropy = select(0.0, disc / trace, trace > 1e-8);

  // R=tx, G=ty, B=magnitude (for refinement weighting), A=anisotropy
  // (carried through tangent_refine unchanged, same as magnitude).
  outputBuf[idx] = vec4<f32>(tangent, mag, anisotropy);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgpu/tangent_refine.wgsl
// Regenerate with `npm run build:shaders`.
const source$t = `override REFINE_TILE_DIM: u32 = WORKGROUP_SIZE + 4u; // fixed 5x5 (radius-2) footprint

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputBuf: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outputBuf: array<vec4<f32>>;

var<workgroup> tile: array<vec4<f32>, REFINE_TILE_DIM * REFINE_TILE_DIM>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(
  @builtin(local_invocation_id) lid: vec3<u32>,
  @builtin(workgroup_id) wgid: vec3<u32>
) {
  let w = i32(params.width);
  let h = i32(params.height);

  let localX = i32(lid.x);
  let localY = i32(lid.y);
  let wgOriginX = i32(wgid.x) * i32(WORKGROUP_SIZE);
  let wgOriginY = i32(wgid.y) * i32(WORKGROUP_SIZE);
  let tileDim = i32(REFINE_TILE_DIM);
  let tileCells = tileDim * tileDim;

  let flatLocal = localY * i32(WORKGROUP_SIZE) + localX;
  var loadIdx = flatLocal;
  loop {
    if (loadIdx >= tileCells) { break; }
    let ty = loadIdx / tileDim;
    let tx = loadIdx % tileDim;
    let sx = wgOriginX + tx - 2;
    let sy = wgOriginY + ty - 2;
    tile[loadIdx] = inputBuf[clampIdx(sx, sy, w, h)];
    loadIdx = loadIdx + i32(WORKGROUP_SIZE * WORKGROUP_SIZE);
  }

  workgroupBarrier();

  let x = wgOriginX + localX;
  let y = wgOriginY + localY;
  if (x >= w || y >= h) { return; }

  let idx = u32(y * w + x);
  let current = tile[(localY + 2) * tileDim + (localX + 2)];
  let currentT = current.xy;

  var sum = vec2<f32>(0.0);
  var weightSum: f32 = 0.0;

  // 5x5 kernel (radius 2)
  for (var ky = -2; ky <= 2; ky = ky + 1) {
    for (var kx = -2; kx <= 2; kx = kx + 1) {
      let neighbor = tile[(localY + 2 + ky) * tileDim + (localX + 2 + kx)];
      let neighborT = neighbor.xy;
      let neighborMag = neighbor.z;

      // Direction weight with sign handling
      let dotVal = dot(currentT, neighborT);
      let signVal = select(-1.0, 1.0, dotVal >= 0.0);
      let dirWeight = abs(dotVal);
      let weight = neighborMag * dirWeight;

      sum = sum + signVal * neighborT * weight;
      weightSum = weightSum + weight;
    }
  }

  var refined = currentT;
  if (weightSum > 1e-10) {
    refined = sum / weightSum;
    let len = length(refined);
    if (len > 1e-10) {
      refined = refined / len;
    }
  }

  // .z (magnitude) and .w (anisotropy) are both static per-pixel scalars
  // derived from the blurred tensor before refinement started — refine
  // only ever touches the tangent direction, so both are carried through
  // unchanged across iterations.
  outputBuf[idx] = vec4<f32>(refined, current.z, current.w);
}`;

/**
 * WebGPU-accelerated Edge Tangent Flow computation
 *
 * Functional port of the WebGL2 implementation (webgl.ts) onto WebGPU
 * compute shaders. Structurally this is much simpler than the WebGL version:
 * every stage is a compute pass over flat storage buffers, addressed by
 * (y * width + x) instead of texture coordinates. Edge-clamping is done
 * manually via clampIdx() rather than relying on CLAMP_TO_EDGE sampler state.
 *
 * NOTE: like the WebGL version's fixed `u_kernel[33]` uniform array (which
 * capped the Gaussian blur radius at 16), the WebGL implementation had to
 * work around GLSL's lack of dynamically-sized arrays. Storage buffers have
 * no such limit here, so the blur radius is only bounded by sanity/perf
 * limits, not by shader syntax. See MAX_BLUR_RADIUS below.
 *
 * Multi-channel support follows Di Zenzo's approach ("A note on the
 * gradient of a multi-image", CVGIP 33, 1986), matching the CPU backend:
 * per-channel structure tensors are summed (not the resulting tangents),
 * and a single eigendecomposition is performed on the combined tensor.
 * On the GPU this means: for each input channel, run the fused
 * gradient/structure-tensor pass and *accumulate* (read-modify-write add)
 * into one shared tensor buffer, rather than overwriting it. See
 * GRADIENT_STRUCTURE_TENSOR_SHADER. Everything from the Gaussian blur pass
 * onward is unchanged regardless of channel count, so compute() is
 * implemented as computeMultiChannel() called with a single-element array.
 *
 * This has no knowledge of color spaces. It only ever sees
 * ChannelImage scalar fields. RGB/Lab/etc. splitting and conversion is
 * the caller's responsibility (see utils/color.ts).
 *
 * ---- Row-band tiling (memory) ----
 * Every WGSL shader here addresses purely through the `Params` uniform
 * (width/height/radius/kernelSize) and clampIdx(). None assume
 * anything about a "global" image size beyond what's passed in. That
 * means a smaller sub-image ("band") of rows is, as far as every shader
 * is concerned, just an image
 *
 * computeInternal() splits the image into horizontal row bands and runs
 * the full pipeline (gradient+tensor-accumulate (fused) -> blur -> extract
 * -> refine) once per band, on band-sized buffers, instead of
 * allocating whole-image buffers. Peak GPU memory is therefore bounded by
 * a fixed, tunable budget (bandMemoryBudgetBytes) rather than by image
 * resolution. See planBandLayout() for the memory math and the
 * `halo` comment in computeInternal() for why each band has to compute
 * more rows than it ultimately outputs.
 *
 * ---- Pipelining (throughput) ----
 * Tiling alone would still leave the GPU idle during every band's
 * CPU-side readback if bands were processed strictly one-at-a-time.
 * Instead, two full sets of band buffers ("slots") are allocated once and
 * reused round-robin across bands: band N's compute is submitted without
 * waiting for band N-1's result to be read back, so the GPU queue stays
 * fed while the CPU drains the previous band's output. See the slot
 * synchronization comment inside computeInternal() for the exact
 * correctness argument (it relies on WebGPU's same-queue in-order
 * execution guarantee, plus explicitly awaiting the relevant readback
 * before a slot's buffers are reused).
 */
// NOTE: isWebGPUComputeSupported() isn't assumed to exist in utils/index.js
// yet (only isWebGLComputeSupported is referenced in webgl.ts), so a local
// equivalent is defined at the bottom of this file. Feel free to hoist it
// into utils/index.js as a sibling of isWebGLComputeSupported.
/** Sanity cap on Gaussian blur radius (pixels). uards against pathological
 * sigma values blowing up dispatch cost. */
const MAX_BLUR_RADIUS = 64;
const WORKGROUP_SIZE$2 = 8;
/**
 * Blur radii up to this value use the shared-memory-tiled blurH/blurV
 * pipelines; anything above it falls back to the original untiled
 * pipelines. This exists purely because `var<workgroup>` arrays must be
 * fixed-size at shader-compile time, so the tile has to be sized for a
 * worst-case radius rather than the actual (data-dependent) one.
 *
 * 32 was chosen to keep per-workgroup storage comfortably under the
 * WebGPU-guaranteed minimum of 16384 bytes (`maxComputeWorkgroupStorageSize`)
 * even though real hardware often allows more:
 *   tile:   (WORKGROUP_SIZE + 2*32) * WORKGROUP_SIZE * 16B (vec4<f32>) = 9216B
 *   kernel: (2*32 + 1) * 4B                                            =  260B
 *   total                                                              = 9476B
 * That leaves ~7KB of headroom for driver overhead/alignment. Radii above
 * this (i.e. large-sigma blurs) are rare in practice and still correct,
 * they just don't get the shared-memory win.
 *
 * Unrelated to row-band tiling below (that's about bounding *image*
 * memory; this is about bounding *workgroup-shared* memory for the blur).
 */
const TILE_RADIUS_CAP = 32;
/**
 * Target peak GPU memory for *one* band-buffer slot (see BandBufferSet
 * and computeInternal()). There are two slots live at once for
 * double-buffering, so actual peak usage is roughly 2x this, plus a
 * small constant for pipelines/kernel/params.
 *
 * This is deliberately conservative (comfortably runs even on a weak
 * integrated GPU) rather than tuned per-adapter, since WebGPU has no API
 * to query *available* (as opposed to theoretical maximum) device memory.
 * Override via WebGpuEdgeTangentFlowComputer.bandMemoryBudgetBytes if you
 * know your target hardware can do better (bigger bands = fewer bands =
 * less halo overhead = faster), or worse (smaller bands = safer).
 */
const DEFAULT_BAND_MEMORY_BUDGET_BYTES = 256 * 1024 * 1024; // 256 MiB
/**
 * Floor on band core-row count. Guards against degenerate configurations
 * (huge halo relative to the memory budget) producing a zero/negative
 * band size, at the cost of possibly exceeding bandMemoryBudgetBytes in
 * that edge case. See planBandLayout().
 */
const MIN_BAND_ROWS = 64;
// ============== WGSL Shader Sources ==============
// Computes one channel's Sobel gradient and *accumulates* its structure
// tensor contribution into accumBuf (Di Zenzo multichannel summation)
// instead of overwriting it. Fused into a single pass since nothing
// downstream ever consumes the raw gradient on its own.
// accumBuf must be zero before the
// first channel's pass each band. See the encoder.clearBuffer() call in
// computeInternal(), which replaces the "freshly-created buffers are
// zero" guarantee the single-shot version used to rely on (band buffers
// are now allocated once and reused).
//
// .w (magnitude) is deliberately left untouched here. Summing each
// channel's individual sqrt(e+g) would be wrong, since sqrt is nonlinear:
// sum(sqrt(e_k + g_k)) != sqrt(sum(e_k) + sum(g_k)). Only the latter is
// the Di Zenzo-consistent combined gradient magnitude, so it's derived
// once from the final accumulated trace directly inside
// TANGENT_EXTRACT_SHADER instead of a separate finalize pass.
const GRADIENT_STRUCTURE_TENSOR_SHADER = source$y + source$x;
// Both blur directions live in the same module. Since WGSL allows multiple
// @compute entry points per shader module, this replaces the WebGL
// version's two separate H/V programs with one module and two pipelines.
const GAUSSIAN_BLUR_SHADER = source$y + source$w;
// Tiled counterpart to GAUSSIAN_BLUR_SHADER, used when radius <=
// TILE_RADIUS_CAP (see that constant's comment for the sizing rationale).
// Each workgroup loads its input footprint into workgroup-shared memory
// once, then every thread reads its taps from shared memory instead of
// re-issuing up to `kernelSize` independent global storage-buffer reads;
// the redundant-read pattern the untiled version has, since neighboring
// threads' kernel windows overlap almost entirely.
const GAUSSIAN_BLUR_TILED_SHADER = source$y + source$v;
const TANGENT_EXTRACT_SHADER = source$y + source$u;
// Unlike the blur radius, the refine neighborhood is a fixed 5x5 (radius
// 2) so the tile size is a compile-time constant with no data-dependent
// cap/fallback needed, unlike GAUSSIAN_BLUR_TILED_SHADER above. Every
// invocation in the untiled version re-read the same 5x5=25 neighbors its
// neighbors were also reading independently from global storage; here
// each workgroup loads its (WORKGROUP_SIZE+4)^2 footprint once instead.
const TANGENT_REFINE_SHADER = source$y + source$t;
/**
 * WebGPU-accelerated ETFComputer. Device/pipeline resources are cached
 * statically (shared across every instance) since acquiring a GPUDevice
 * is expensive and none of that state depends on image size or channel
 * count; per-call state (band buffers) is still allocated fresh in
 * computeInternal().
 */
class WebGpuEdgeTangentFlowComputer extends BaseWebGPUStrategy {
    static resources = null;
    static resourcesPromise = null;
    /**
     * Target peak GPU memory for one band-buffer slot. See the constant's
     * doc comment above for context; exposed as a static so callers who
     * know their target hardware can tune it without forking this file.
     * Changing it takes effect on the next compute()/computeMultiChannel()
     * call (band layout is computed fresh per call).
     */
    static bandMemoryBudgetBytes = DEFAULT_BAND_MEMORY_BUDGET_BYTES;
    /**
     * This cheap check simply confirms the API surface exists; it can't confirm
     * an adapter is actually obtainable (that requires the async
     * requestAdapter() call made lazily inside
     * initResources()/computeInternal()). use getUnsupportedReason() for
     * that deeper check.
     */
    static async isSupported() {
        return isWebGPUComputeSupported();
    }
    /**
     * Optional richer diagnostic, matching the ETFComputerCtor shape in
     * types.ts. Async, since it actually attempts to obtain an adapter.
     */
    static async getUnsupportedReason() {
        if (typeof navigator === 'undefined' || !navigator.gpu) {
            return 'navigator.gpu is unavailable in this environment';
        }
        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                return 'No WebGPU adapter could be obtained';
            }
            return undefined;
        }
        catch (err) {
            return `WebGPU adapter request failed: ${err.message}`;
        }
    }
    /**
     * Initialize WebGPU device + pipelines (lazy, cached, size-independent).
     */
    static async initResources() {
        if (this.resources) {
            return this.resources;
        }
        if (this.resourcesPromise) {
            return this.resourcesPromise;
        }
        this.resourcesPromise = (async () => {
            if (!navigator.gpu) {
                throw new Error('WebGPU not supported in this environment');
            }
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                throw new Error('Failed to obtain a WebGPU adapter');
            }
            const hasTimestampQuery = adapter.features.has('timestamp-query');
            // Without explicit requiredLimits, WebGPU hands back the *default*
            // limits (maxBufferSize/maxStorageBufferBindingSize commonly 256MB/
            // 128MB) rather than what the adapter can actually do. Band buffers
            // are sized well under that regardless (see
            // DEFAULT_BAND_MEMORY_BUDGET_BYTES), but requesting the real
            // adapter limits still raises the ceiling for callers who bump
            // bandMemoryBudgetBytes up on capable hardware.
            const device = await adapter.requestDevice({
                requiredFeatures: hasTimestampQuery ? ['timestamp-query'] : [],
                requiredLimits: {
                    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
                    maxBufferSize: adapter.limits.maxBufferSize,
                },
            });
            device.lost.then((info) => {
                // Invalidate the cache so the next call re-initializes.
                if (this.resources && this.resources.device === device) {
                    this.resources = null;
                    this.resourcesPromise = null;
                }
                console.warn(`WebGPU device lost: ${info.message}`);
            });
            // Every shader module below declares `override WORKGROUP_SIZE: u32`
            // (via #include "./_workgroup.wgsl") instead of having it baked in
            // as a JS-side template value, so it has to be supplied here at
            // pipeline-creation time. TILE_WIDTH/KERNEL_SHARED_SIZE/
            // REFINE_TILE_DIM are override-expressions *derived* from
            // WORKGROUP_SIZE (and TILE_RADIUS_CAP) inside the WGSL itself, so
            // they don't need their own entries here.
            const makePipeline = (code, entryPoint = 'main', constants = { WORKGROUP_SIZE: WORKGROUP_SIZE$2 }) => device.createComputePipeline({
                layout: 'auto',
                compute: {
                    module: device.createShaderModule({ code }),
                    entryPoint,
                    constants,
                },
            });
            const blurModule = device.createShaderModule({ code: GAUSSIAN_BLUR_SHADER });
            const blurHPipeline = device.createComputePipeline({
                layout: 'auto',
                compute: { module: blurModule, entryPoint: 'blurH', constants: { WORKGROUP_SIZE: WORKGROUP_SIZE$2 } },
            });
            const blurVPipeline = device.createComputePipeline({
                layout: 'auto',
                compute: { module: blurModule, entryPoint: 'blurV', constants: { WORKGROUP_SIZE: WORKGROUP_SIZE$2 } },
            });
            const blurTiledModule = device.createShaderModule({ code: GAUSSIAN_BLUR_TILED_SHADER });
            const blurHTiledPipeline = device.createComputePipeline({
                layout: 'auto',
                compute: {
                    module: blurTiledModule,
                    entryPoint: 'blurHTiled',
                    constants: { WORKGROUP_SIZE: WORKGROUP_SIZE$2, TILE_RADIUS_CAP },
                },
            });
            const blurVTiledPipeline = device.createComputePipeline({
                layout: 'auto',
                compute: {
                    module: blurTiledModule,
                    entryPoint: 'blurVTiled',
                    constants: { WORKGROUP_SIZE: WORKGROUP_SIZE$2, TILE_RADIUS_CAP },
                },
            });
            const resources = {
                device,
                gradientStructureTensorPipeline: makePipeline(GRADIENT_STRUCTURE_TENSOR_SHADER),
                blurHPipeline,
                blurVPipeline,
                blurHTiledPipeline,
                blurVTiledPipeline,
                tangentExtractPipeline: makePipeline(TANGENT_EXTRACT_SHADER),
                tangentRefinePipeline: makePipeline(TANGENT_REFINE_SHADER),
                hasTimestampQuery,
            };
            this.resources = resources;
            return resources;
        })();
        return this.resourcesPromise;
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
    /**
     * Compute ETF from a single scalar channel using WebGPU compute shaders.
     * Implemented as computeMultiChannel() with a single-element array. the
     * per-channel accumulate pass degenerates to a plain assignment when
     * there's only one channel (see GRADIENT_STRUCTURE_TENSOR_SHADER).
     */
    async compute(input, config = {}, sigmaC) {
        return await this.computeInternal([input], config, sigmaC);
    }
    /**
     * Compute ETF jointly from several co-registered scalar channels (e.g.
     * R/G/B or L/a/b), using Di Zenzo's multichannel structure tensor. All
     * channels must share the same width/height.
     */
    async computeMultiChannel(inputs, config = {}, sigmaC) {
        this.validateChannels(inputs);
        return await this.computeInternal(inputs, config, sigmaC);
    }
    /**
     * Release the cached WebGPU device + pipelines. Safe to call even if no
     * compute()/computeMultiChannel() call has happened yet. Since the
     * underlying resources are cached statically, this releases them for every
     * WebGpuEdgeTangentFlowComputer instance, not just this one; call it
     * once you're done with all ETF computations for the session.
     */
    dispose() {
        const ctor = WebGpuEdgeTangentFlowComputer;
        if (ctor.resources) {
            ctor.resources.device.destroy();
            ctor.resources = null;
            ctor.resourcesPromise = null;
        }
    }
    /**
     * Shared implementation behind compute() and computeMultiChannel().
     *
     * Splits the image into horizontal row bands and runs the full
     * gradient+tensor-accumulate (fused) -> blur -> extract -> refine
     * pipeline once per band, on two round-robin, reused,
     * band-sized buffer sets ("slots"). See the module-level doc comment
     * for why this bounds memory and how the double-buffering keeps the
     * GPU fed. Buffer allocation, band-size planning, and the halo math
     * are the only real additions versus a single-shot whole-image run;
     * every WGSL pipeline and bind-group-layout is identical to the
     * non-tiled version, since every shader already only knows about
     * whatever width/height it's told via Params.
     */
    async computeInternal(inputs, config, sigmaC) {
        const cfg = { ...DEFAULT_ETF_CONFIG, ...config };
        const { width, height } = inputs[0];
        const channelCount = inputs.length;
        const res = await WebGpuEdgeTangentFlowComputer.initResources();
        const { device } = res;
        const smoothSigma = sigmaC ?? cfg.kernelSize / 2.45;
        const radius = Math.min(MAX_BLUR_RADIUS, Math.max(1, Math.ceil(smoothSigma * 2.45)));
        const kernelSize = radius * 2 + 1;
        const kernel = generateGaussianKernel(smoothSigma, kernelSize);
        // `halo` is how many extra rows above/below a band's *target* output
        // rows have to be computed (and hence loaded) for those target rows
        // to come out identical to a full, untiled run:
        //   +/1        Sobel gradient stencil (gradient.wgsl)
        //   +/-radius   separable Gaussian blur (blurH then blurV: a single
        //             `radius` margin covers both passes: blurH is computed
        //             row-independently so needs no extra y-margin itself,
        //             and blurV only needs blurH's output `radius` rows out,
        //             which that single margin already provides)
        //   +/-2*iters  5x5 tangent-refine kernel, applied `iterations` times:
        //             each pass "eats" 2 rows of validity from the band's
        //             edges, so the untouched margin has to start
        //             2*iterations rows out from the target rows
        // These layers are consumed outside-in as you move inward from the
        // band edge (refine's margin is "wrong" first, protecting the blur
        // margin inside it, which protects the 1-row gradient margin inside
        // that), which is why the contributions add rather than multiply.
        const halo = radius + 1 + 2 * cfg.iterations;
        const { bandRows, numBands } = planBandLayout(width, height, channelCount, halo, device.limits, WebGpuEdgeTangentFlowComputer.bandMemoryBudgetBytes);
        const maxBandBufHeight = Math.min(bandRows, height) + 2 * halo;
        const kernelBuf = createBufferWithData(device, kernel, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        const dispatchX = Math.ceil(width / WORKGROUP_SIZE$2);
        return this.runGuarded(device, async () => {
            // Two full sets of band-sized buffers, alternated per band, so band
            // N's compute can be submitted before band N-1's result has
            // finished being read back. See synchronization note below.
            const slots = [
                createBandBufferSet(device, width, maxBandBufHeight, channelCount),
                createBandBufferSet(device, width, maxBandBufHeight, channelCount),
            ];
            // Reusable JS-side scratch for building each band's halo-padded,
            // edge-clamped channel rows. one buffer per (slot, channel), sized
            // once up front instead of allocated fresh every band.
            const channelScratch = [0, 1].map(() => inputs.map(() => new Float32Array(width * maxBandBufHeight)));
            const tangents = new Float32Array(width * height * 2);
            const magnitude = new Float32Array(width * height);
            const anisotropy = new Float32Array(width * height);
            // Slot's in-flight "read this band's staging buffer back to the
            // CPU" promise, if any. Indexed by slot (0 or 1), not by band.
            const pendingReadback = [null, null];
            try {
                for (let bandIdx = 0; bandIdx < numBands; bandIdx++) {
                    const slot = bandIdx % 2;
                    const bufs = slots[slot];
                    const bandStartY = bandIdx * bandRows;
                    const bandRowsThisBand = Math.min(bandRows, height - bandStartY);
                    const bandBufHeight = bandRowsThisBand + 2 * halo;
                    const bandPixelCount = width * bandBufHeight;
                    // This slot's buffers were last used two bands ago (or never,
                    // for bandIdx < 2). Before touching them again (uploading new
                    // channel data, clearing tensorAccumBuf, or recording new
                    // commands that target them) make sure that band's GPU work
                    // is done and, critically, that its staging buffer has been
                    // unmap()'d: WebGPU rejects any submission that references a
                    // still-mapped buffer, and mapAsync()/unmap() are the one part
                    // of this loop that ISN'T covered by the queue's automatic
                    // same-queue-in-order execution guarantee.
                    if (pendingReadback[slot]) {
                        await pendingReadback[slot];
                        pendingReadback[slot] = null;
                    }
                    // ---- Build + upload this band's halo-padded channel rows ----
                    for (let k = 0; k < channelCount; k++) {
                        const scratch = channelScratch[slot][k];
                        buildChannelBandData(inputs[k].data, width, height, bandStartY, bandRowsThisBand, halo, scratch);
                        device.queue.writeBuffer(bufs.channelInputBufs[k], 0, scratch.buffer, 0, bandPixelCount * 4);
                    }
                    // Params for every pointwise/gradient/extract/refine pass this
                    // band (radius/kernelSize unused by those shaders); a separate
                    // one for the two blur passes, which do need radius/kernelSize.
                    // `height` here is the *band's* local height, not the image's.
                    const params = createParamsBuffer(device, { width, height: bandBufHeight, radius: 0, kernelSize: 0 });
                    const blurParams = createParamsBuffer(device, { width, height: bandBufHeight, radius, kernelSize });
                    const dispatchY = Math.ceil(bandBufHeight / WORKGROUP_SIZE$2);
                    const encoder = device.createCommandEncoder();
                    // tensorAccumBuf is reused across bands (unlike the one-shot
                    // version, which relied on freshly-created WebGPU buffers being
                    // guaranteed zero), so it has to be explicitly re-zeroed before
                    // each band's per-channel accumulation loop.
                    encoder.clearBuffer(bufs.tensorAccumBuf);
                    // Step 1: per channel, fused gradient + structure-tensor-accumulate
                    // directly into tensorAccumBuf.
                    for (let k = 0; k < channelCount; k++) {
                        const bindGroup = device.createBindGroup({
                            layout: res.gradientStructureTensorPipeline.getBindGroupLayout(0),
                            entries: [
                                { binding: 0, resource: { buffer: params } },
                                { binding: 1, resource: { buffer: bufs.channelInputBufs[k] } },
                                { binding: 2, resource: { buffer: bufs.tensorAccumBuf } },
                            ],
                        });
                        const pass = encoder.beginComputePass();
                        pass.setPipeline(res.gradientStructureTensorPipeline);
                        pass.setBindGroup(0, bindGroup);
                        pass.dispatchWorkgroups(dispatchX, dispatchY);
                        pass.end();
                    }
                    // Step 2: Gaussian blur the structure tensor (horizontal then vertical).
                    {
                        const useTiledBlur = radius <= TILE_RADIUS_CAP;
                        const blurHPipe = useTiledBlur ? res.blurHTiledPipeline : res.blurHPipeline;
                        const blurVPipe = useTiledBlur ? res.blurVTiledPipeline : res.blurVPipeline;
                        const bindGroupH = device.createBindGroup({
                            layout: blurHPipe.getBindGroupLayout(0),
                            entries: [
                                { binding: 0, resource: { buffer: blurParams } },
                                { binding: 1, resource: { buffer: bufs.tensorAccumBuf } },
                                { binding: 2, resource: { buffer: bufs.blurTempBuf } },
                                { binding: 3, resource: { buffer: kernelBuf } },
                            ],
                        });
                        const passH = encoder.beginComputePass();
                        passH.setPipeline(blurHPipe);
                        passH.setBindGroup(0, bindGroupH);
                        passH.dispatchWorkgroups(dispatchX, dispatchY);
                        passH.end();
                        const bindGroupV = device.createBindGroup({
                            layout: blurVPipe.getBindGroupLayout(0),
                            entries: [
                                { binding: 0, resource: { buffer: blurParams } },
                                { binding: 1, resource: { buffer: bufs.blurTempBuf } },
                                { binding: 2, resource: { buffer: bufs.blurOutputBuf } },
                                { binding: 3, resource: { buffer: kernelBuf } },
                            ],
                        });
                        const passV = encoder.beginComputePass();
                        passV.setPipeline(blurVPipe);
                        passV.setBindGroup(0, bindGroupV);
                        passV.dispatchWorkgroups(dispatchX, dispatchY);
                        passV.end();
                    }
                    // Step 3: extract initial tangent field.
                    {
                        const bindGroup = device.createBindGroup({
                            layout: res.tangentExtractPipeline.getBindGroupLayout(0),
                            entries: [
                                { binding: 0, resource: { buffer: params } },
                                { binding: 1, resource: { buffer: bufs.blurOutputBuf } },
                                { binding: 2, resource: { buffer: bufs.tangentBuf1 } },
                            ],
                        });
                        const pass = encoder.beginComputePass();
                        pass.setPipeline(res.tangentExtractPipeline);
                        pass.setBindGroup(0, bindGroup);
                        pass.dispatchWorkgroups(dispatchX, dispatchY);
                        pass.end();
                    }
                    // Step 4: refine tangent field iteratively (ping-pong between buffers).
                    let readBuf = bufs.tangentBuf1;
                    let writeBuf = bufs.tangentBuf2;
                    for (let i = 0; i < cfg.iterations; i++) {
                        const bindGroup = device.createBindGroup({
                            layout: res.tangentRefinePipeline.getBindGroupLayout(0),
                            entries: [
                                { binding: 0, resource: { buffer: params } },
                                { binding: 1, resource: { buffer: readBuf } },
                                { binding: 2, resource: { buffer: writeBuf } },
                            ],
                        });
                        const pass = encoder.beginComputePass();
                        pass.setPipeline(res.tangentRefinePipeline);
                        pass.setBindGroup(0, bindGroup);
                        pass.dispatchWorkgroups(dispatchX, dispatchY);
                        pass.end();
                        [readBuf, writeBuf] = [writeBuf, readBuf];
                    }
                    // Copy this band's final tangent buffer into its slot's staging
                    // buffer. This is deliberately the LAST command in the
                    // submission: awaiting its mapAsync (below) is then sufficient
                    // proof that every earlier command in this band's submission
                    // has finished on the GPU, without any further explicit synchronization.
                    encoder.copyBufferToBuffer(readBuf, 0, bufs.stagingBuf, 0, bandPixelCount * 4 * 4);
                    device.queue.submit([encoder.finish()]);
                    // Deliberately stashed. The next
                    // time this slot comes up (two bands from now) we await it
                    // before reusing these buffers. That gap is what lets band
                    // N+1's upload + dispatch overlap with band N's GPU execution
                    // and CPU-side readback instead of stalling on it.
                    const capturedBandStartY = bandStartY;
                    const capturedBandRows = bandRowsThisBand;
                    pendingReadback[slot] = (async () => {
                        await bufs.stagingBuf.mapAsync(GPUMapMode.READ);
                        const mapped = new Float32Array(bufs.stagingBuf.getMappedRange(0, bandPixelCount * 4 * 4).slice(0));
                        bufs.stagingBuf.unmap();
                        writeBandOutputRows(mapped, width, capturedBandStartY, capturedBandRows, halo, tangents, magnitude, anisotropy);
                    })();
                }
                await Promise.all(pendingReadback.filter((p) => p !== null));
                // Drain whichever 1-2 bands are still in flight after the loop.
                await Promise.all(pendingReadback.filter((p) => p !== null));
            }
            finally {
                // Cleanup runs even if a band's compute/readback threw, so a
                // mid-run failure on a huge image doesn't leak GPU memory.
                for (const bufs of slots)
                    destroyBandBufferSet(bufs);
                kernelBuf.destroy();
            }
            return TangentFlowField.fromFloat32Array(tangents, width, height, magnitude, anisotropy);
        });
    }
}
// ============== Helper Functions ==============
function alignTo4(bytes) {
    return Math.ceil(bytes / 4) * 4;
}
function createBufferWithData(device, data, usage) {
    const size = alignTo4(data.byteLength);
    const buffer = device.createBuffer({ size, usage, mappedAtCreation: true });
    new Float32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
}
function createEmptyVec4Buffer(device, pixelCount) {
    return device.createBuffer({
        size: pixelCount * 4 * 4, // vec4<f32>
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
}
function createParamsBuffer(device, params) {
    const buffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, new Uint32Array([params.width, params.height, params.radius, params.kernelSize]));
    return buffer;
}
function generateGaussianKernel(sigma, size) {
    const kernel = new Float32Array(size);
    const center = Math.floor(size / 2);
    let sum = 0;
    for (let i = 0; i < size; i++) {
        const x = i - center;
        kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
        sum += kernel[i];
    }
    for (let i = 0; i < size; i++) {
        kernel[i] /= sum;
    }
    return kernel;
}
/**
 * Decide how many core (non-halo) rows each band should cover, and how
 * many bands that means for the image, given a per-slot memory budget.
 *
 * Every intermediate that scales with band height is a whole-band
 * vec4<f32> buffer (16 bytes/pixel): tensorAccum, blurTemp, blurOutput,
 * tangentBuf1, tangentBuf2,
 * plus one scalar f32 input buffer per channel (4 bytes/pixel), plus one
 * vec4 staging buffer for readback (16 bytes/pixel). `bandRows` is chosen
 * so that (bandRows + 2*halo) rows of all of those together fit under
 * budgetBytes, floored at MIN_BAND_ROWS so a large halo can't produce a
 * degenerate (zero/negative) band. In that edge case the actual
 * footprint may exceed budgetBytes; see the thrown error below for the
 * case where it can't be made to fit even at the floor.
 */
function planBandLayout(width, height, channelCount, halo, limits, budgetBytes) {
    const bytesPerRow = width * (5 * 16 + channelCount * 4 + 16);
    let bandRows = Math.floor(budgetBytes / bytesPerRow) - 2 * halo;
    bandRows = Math.max(MIN_BAND_ROWS, bandRows);
    bandRows = Math.min(bandRows, height);
    // Hard device ceiling: the padded band buffer still has to fit within
    // a single storage binding. Shrink toward MIN_BAND_ROWS if needed.
    const maxBindableBytes = Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize);
    while (bandRows > MIN_BAND_ROWS && (bandRows + 2 * halo) * width * 16 > maxBindableBytes) {
        bandRows = Math.max(MIN_BAND_ROWS, bandRows - MIN_BAND_ROWS);
    }
    const bandBufHeight = bandRows + 2 * halo;
    if (bandBufHeight * width * 16 > maxBindableBytes) {
        throw new Error(`[EdgeTangentFlowWebGPU] Cannot fit even a ${MIN_BAND_ROWS}-row band ` +
            `(halo=${halo} rows, from blur radius + refine iterations) within ` +
            `this device's maxStorageBufferBindingSize/maxBufferSize ` +
            `(${maxBindableBytes} bytes) at width=${width}. Reduce blur sigma/` +
            `radius or refine iterations, or downscale the image.`);
    }
    const numBands = Math.max(1, Math.ceil(height / bandRows));
    return { bandRows, numBands };
}
/**
 * Allocate one full set of band-sized GPU buffers, sized for
 * maxBandBufHeight rows (the largest band that will occur this call).
 */
function createBandBufferSet(device, width, maxBandBufHeight, channelCount) {
    const pixelCount = width * maxBandBufHeight;
    return {
        channelInputBufs: Array.from({ length: channelCount }, () => device.createBuffer({
            size: alignTo4(pixelCount * 4),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        })),
        tensorAccumBuf: createEmptyVec4Buffer(device, pixelCount),
        blurTempBuf: createEmptyVec4Buffer(device, pixelCount),
        blurOutputBuf: createEmptyVec4Buffer(device, pixelCount),
        tangentBuf1: createEmptyVec4Buffer(device, pixelCount),
        tangentBuf2: createEmptyVec4Buffer(device, pixelCount),
        stagingBuf: device.createBuffer({
            size: pixelCount * 4 * 4,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        }),
    };
}
function destroyBandBufferSet(set) {
    for (const buf of set.channelInputBufs)
        buf.destroy();
    set.tensorAccumBuf.destroy();
    set.blurTempBuf.destroy();
    set.blurOutputBuf.destroy();
    set.tangentBuf1.destroy();
    set.tangentBuf2.destroy();
    set.stagingBuf.destroy();
}
/**
 * Fill `out` (length must be width * (bandRows + 2*halo)) with this
 * channel's rows [bandStartY - halo, bandStartY + bandRows + halo),
 * clamping source row indices to [0, height-1]. i.e. replicating the
 * true image's top/bottom edge rows exactly where clampIdx() would have,
 * had this been computed as part of a single whole-image run. Interior
 * band boundaries (not at the true image edge) get real neighboring row
 * data, not clamped/replicated data.
 */
function buildChannelBandData(src, width, height, bandStartY, bandRows, halo, out) {
    const bandBufHeight = bandRows + 2 * halo;
    for (let localY = 0; localY < bandBufHeight; localY++) {
        const srcY = Math.max(0, Math.min(height - 1, bandStartY - halo + localY));
        out.set(src.subarray(srcY * width, srcY * width + width), localY * width);
    }
}
/**
 * Crop the halo off a band's mapped (stride-4: x, y, magnitude,
 * anisotropy) readback and write the core (stride-2: x, y) rows into the
 * full-image output buffers at the right offset.
 */
function writeBandOutputRows(mapped, width, bandStartY, bandRows, halo, tangentsOut, magnitudeOut, anisotropyOut) {
    for (let localY = 0; localY < bandRows; localY++) {
        const srcRowOffset = (halo + localY) * width * 4;
        const dstRowOffset = (bandStartY + localY) * width * 2;
        const dstScalarOffset = (bandStartY + localY) * width;
        for (let x = 0; x < width; x++) {
            tangentsOut[dstRowOffset + x * 2] = mapped[srcRowOffset + x * 4];
            tangentsOut[dstRowOffset + x * 2 + 1] = mapped[srcRowOffset + x * 4 + 1];
            magnitudeOut[dstScalarOffset + x] = mapped[srcRowOffset + x * 4 + 2];
            anisotropyOut[dstScalarOffset + x] = mapped[srcRowOffset + x * 4 + 3];
        }
    }
}
/**
 * Local equivalent of isWebGLComputeSupported() from utils/index.js.
 * Consider hoisting this into utils/index.js as a sibling export.
 */
function isWebGPUComputeSupported() {
    return typeof navigator !== 'undefined' && !!navigator.gpu;
}

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgl/vertex.glsl
// Regenerate with `npm run build:shaders`.
const source$s = `#version 300 es
precision highp float;
in vec2 a_position;
out vec2 v_texCoord;

void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgl/gradient.glsl
// Regenerate with `npm run build:shaders`.
const source$r = `#version 300 es
precision highp float;

uniform sampler2D u_input;
uniform vec2 u_resolution;

in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor;

void main() {
  vec2 texel = 1.0 / u_resolution;
  
  // Sobel operator
  float p00 = texture(u_input, v_texCoord + vec2(-1, -1) * texel).r;
  float p10 = texture(u_input, v_texCoord + vec2( 0, -1) * texel).r;
  float p20 = texture(u_input, v_texCoord + vec2( 1, -1) * texel).r;
  float p01 = texture(u_input, v_texCoord + vec2(-1,  0) * texel).r;
  float p21 = texture(u_input, v_texCoord + vec2( 1,  0) * texel).r;
  float p02 = texture(u_input, v_texCoord + vec2(-1,  1) * texel).r;
  float p12 = texture(u_input, v_texCoord + vec2( 0,  1) * texel).r;
  float p22 = texture(u_input, v_texCoord + vec2( 1,  1) * texel).r;
  
  float gx = -p00 + p20 - 2.0 * p01 + 2.0 * p21 - p02 + p22;
  float gy = -p00 - 2.0 * p10 - p20 + p02 + 2.0 * p12 + p22;
  float mag = length(vec2(gx, gy));
  
  // Output: R=gx, G=gy, B=magnitude
  fragColor = vec4(gx, gy, mag, 1.0);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgl/structural_tensor.glsl
// Regenerate with `npm run build:shaders`.
const source$q = `#version 300 es
precision highp float;

uniform sampler2D u_input;
uniform vec2 u_resolution;

in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor;

void main() {
  vec2 texel = 1.0 / u_resolution;
  
  // Sobel operator
  float p00 = texture(u_input, v_texCoord + vec2(-1, -1) * texel).r;
  float p10 = texture(u_input, v_texCoord + vec2( 0, -1) * texel).r;
  float p20 = texture(u_input, v_texCoord + vec2( 1, -1) * texel).r;
  float p01 = texture(u_input, v_texCoord + vec2(-1,  0) * texel).r;
  float p21 = texture(u_input, v_texCoord + vec2( 1,  0) * texel).r;
  float p02 = texture(u_input, v_texCoord + vec2(-1,  1) * texel).r;
  float p12 = texture(u_input, v_texCoord + vec2( 0,  1) * texel).r;
  float p22 = texture(u_input, v_texCoord + vec2( 1,  1) * texel).r;
  
  float gx = -p00 + p20 - 2.0 * p01 + 2.0 * p21 - p02 + p22;
  float gy = -p00 - 2.0 * p10 - p20 + p02 + 2.0 * p12 + p22;

  // Structure tensor components: E = Ix^2, F = Ix*Iy, G = Iy^2.
  float e = gx * gx;
  float f = gx * gy;
  float g = gy * gy;

  // Magnitude deliberately NOT computed here — see finalize_magnitude.glsl.
  fragColor = vec4(e, f, g, 1.0);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgl/gaussian_blur_h.glsl
// Regenerate with `npm run build:shaders`.
const source$p = `#version 300 es
precision highp float;

uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_kernel[33]; // Max kernel size 33
uniform int u_kernelSize;
uniform int u_radius;

in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor;

void main() {
  vec2 texel = vec2(1.0 / u_resolution.x, 0.0);
  vec4 sum = vec4(0.0);
  
  for (int i = 0; i < u_kernelSize; i++) {
    vec2 offset = texel * float(i - u_radius);
    vec2 sampleCoord = clamp(v_texCoord + offset, vec2(0.0), vec2(1.0));
    sum += texture(u_input, sampleCoord) * u_kernel[i];
  }
  
  fragColor = sum;
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgl/gaussian_blur_v.glsl
// Regenerate with `npm run build:shaders`.
const source$o = `#version 300 es
precision highp float;

uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_kernel[33];
uniform int u_kernelSize;
uniform int u_radius;

in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor;

void main() {
  vec2 texel = vec2(0.0, 1.0 / u_resolution.y);
  vec4 sum = vec4(0.0);
  
  for (int i = 0; i < u_kernelSize; i++) {
    vec2 offset = texel * float(i - u_radius);
    vec2 sampleCoord = clamp(v_texCoord + offset, vec2(0.0), vec2(1.0));
    sum += texture(u_input, sampleCoord) * u_kernel[i];
  }
  
  fragColor = sum;
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgl/tangent_extract.glsl
// Regenerate with `npm run build:shaders`.
const source$n = `#version 300 es
precision highp float;

uniform sampler2D u_tensor;

in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor;

void main() {
  vec4 tensor = texture(u_tensor, v_texCoord);
  float e = tensor.r;
  float f = tensor.g;
  float g = tensor.b;
  float mag = tensor.a;
    
  // Compute eigenvector for smallest eigenvalue
  float diff = e - g;
  float disc = sqrt(diff * diff + 4.0 * f * f);
  
  vec2 tangent;
  
  if (abs(f) > 1e-10) {
    float lambda1 = (e + g - disc) * 0.5;
    tangent = vec2(lambda1 - g, f);
  } else if (e < g) {
    tangent = vec2(1.0, 0.0);
  } else {
    tangent = vec2(0.0, 1.0);
  }
  
  // Normalize
  float len = length(tangent);
  if (len > 1e-10) {
    tangent /= len;
  }

  // Anisotropy: (lambda1-lambda2)/(lambda1+lambda2) = disc/trace. \`disc\`
  // is already computed above for the eigenvector; trace = e+g.
  float trace = e + g;
  float anisotropy = trace > 1e-8 ? disc / trace : 0.0;

  // Output: R=tx, G=ty, B=magnitude (for refinement weighting),
  // A=anisotropy (carried through tangent_refine unchanged, same as magnitude).
  fragColor = vec4(tangent, mag, anisotropy);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgl/tangent_refine.glsl
// Regenerate with `npm run build:shaders`.
const source$m = `#version 300 es
precision highp float;

uniform sampler2D u_tangents;
uniform vec2 u_resolution;

in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor;

void main() {
  vec2 texel = 1.0 / u_resolution;
  
  vec4 current = texture(u_tangents, v_texCoord);
  vec2 currentT = current.rg;
  float currentMag = current.b;
  
  vec2 sum = vec2(0.0);
  float weightSum = 0.0;
  
  // 5x5 kernel (radius 2)
  for (int ky = -2; ky <= 2; ky++) {
    for (int kx = -2; kx <= 2; kx++) {
      vec2 offset = vec2(float(kx), float(ky)) * texel;
      vec2 sampleCoord = clamp(v_texCoord + offset, vec2(0.0), vec2(1.0));
      
      vec4 neighbor = texture(u_tangents, sampleCoord);
      vec2 neighborT = neighbor.rg;
      float neighborMag = neighbor.b;
      
      // Direction weight with sign handling
      float dot_val = dot(currentT, neighborT);
      float sign_val = dot_val >= 0.0 ? 1.0 : -1.0;
      float dirWeight = abs(dot_val);
      
      float weight = neighborMag * dirWeight;
      
      sum += sign_val * neighborT * weight;
      weightSum += weight;
    }
  }
  
  vec2 refined = currentT;
  if (weightSum > 1e-10) {
    refined = sum / weightSum;
    float len = length(refined);
    if (len > 1e-10) {
      refined /= len;
    }
  }
  
  // .b (magnitude) and .a (anisotropy) are both static per-pixel scalars
  // derived from the blurred tensor before refinement started — refine
  // only ever touches the tangent direction, so both are carried through
  // unchanged across iterations.
  fragColor = vec4(refined, current.b, current.a);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: etf/shaders/webgl/finalize_magnitude.glsl
// Regenerate with `npm run build:shaders`.
const source$l = `#version 300 es
precision highp float;

uniform sampler2D u_tensor; // accumulated (summed) E, F, G in .rgb

in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor;

void main() {
  vec4 tensor = texture(u_tensor, v_texCoord);
  float mag = sqrt(max(tensor.r + tensor.b, 0.0)); // sqrt(E + G), once, from the combined trace
  fragColor = vec4(tensor.r, tensor.g, tensor.b, mag);
}`;

/**
 * WebGL-accelerated Edge Tangent Flow computation
 *
 * Provides significant speedup over the CPU implementation by running
 * gradient computation, structure tensor building/smoothing, and
 * tangent extraction on the GPU.
 *
 * Multi-channel support follows the same Di Zenzo multichannel structure
 * tensor approach as the CPU backend (per-channel tensors summed, then a
 * single eigendecomposition on the combined tensor) but the summation
 * itself is done on the GPU via additive blending straight into an
 * accumulator framebuffer, rather than reading tensors back to JS and
 * summing them there. Everything from the Gaussian blur pass onward is
 * identical whether the accumulated tensor came from one channel or many.
 */
/**
 * WebGL-backed ETFComputer. Holds a lazily-initialized GPU context and
 * shader programs; call dispose() when done to release them.
 */
class WebGLEdgeTangentFlowComputer extends BaseWebGLStrategy {
    resources = null;
    /**
     * Check if WebGL2 with the required float texture extensions is
     * supported in the current environment. Async to match the
     * `ETFComputerCtor` shape shared with the WebGPU backend, even though
     * this particular check is cheap and synchronous under the hood.
     */
    static async isSupported() {
        return isWebGLComputeSupported();
    }
    static getUnsupportedReason() {
        if (isWebGLComputeSupported()) {
            return undefined;
        }
        return 'WebGL2 with float texture support (EXT_color_buffer_float) is not available in this environment';
    }
    async compute(input, config = {}, sigmaC) {
        return await this.computeDetailed(input, config, sigmaC);
    }
    async computeDetailed(input, config = {}, sigmaC) {
        return this.computeMultiChannelDetailed([input], config, sigmaC);
    }
    async computeMultiChannel(inputs, config = {}, sigmaC) {
        return await this.computeMultiChannelDetailed(inputs, config, sigmaC);
    }
    async computeMultiChannelDetailed(inputs, config = {}, sigmaC) {
        if (inputs.length === 0) {
            throw new Error('computeMultiChannel requires at least one channel');
        }
        const { width, height } = inputs[0];
        for (const channel of inputs) {
            if (channel.width !== width || channel.height !== height) {
                throw new Error('All channels passed to computeMultiChannel must share the same dimensions');
            }
        }
        const cfg = { ...DEFAULT_ETF_CONFIG, ...config };
        const res = this.initResources(width, height);
        const { gl } = res;
        return this.runGuarded(gl, () => {
            gl.viewport(0, 0, width, height);
            // Per-channel scratch (overwritten each iteration) and the tensor
            // accumulator that channels are additively blended into.
            const gradientFB = createFramebuffer$1(gl, width, height, gl.RGBA32F);
            const tensorAccumFB = createFramebuffer$1(gl, width, height, gl.RGBA32F);
            const blurTempFB = createFramebuffer$1(gl, width, height, gl.RGBA32F);
            const blurOutputFB = createFramebuffer$1(gl, width, height, gl.RGBA32F);
            const tangentFB1 = createFramebuffer$1(gl, width, height, gl.RGBA32F);
            const tangentFB2 = createFramebuffer$1(gl, width, height, gl.RGBA32F);
            const tensorFinalizedFB = createFramebuffer$1(gl, width, height, gl.RGBA32F);
            const channelTextures = [];
            try {
                // Step 1 & 2 (Di Zenzo summation): for each channel, compute its
                // gradients, then build its structure tensor and additively blend
                // it into tensorAccumFB. E, F, G, and magnitude (the tensor's
                // trace-derived sqrt(E+G)) are all additive across channels, so
                // hardware ONE+ONE blending performs exactly the same summation
                // the CPU backend does in JS, without a readback per channel.
                gl.bindFramebuffer(gl.FRAMEBUFFER, tensorAccumFB.fb);
                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);
                for (const channel of inputs) {
                    const inputTex = createTexture(gl, width, height, gl.R32F, gl.RED, channel.data);
                    channelTextures.push(inputTex);
                    // Gradient pass: plain overwrite, no blending.
                    gl.disable(gl.BLEND);
                    gl.bindFramebuffer(gl.FRAMEBUFFER, gradientFB.fb);
                    gl.useProgram(res.gradientProgram);
                    gl.activeTexture(gl.TEXTURE0);
                    gl.bindTexture(gl.TEXTURE_2D, inputTex);
                    gl.uniform1i(gl.getUniformLocation(res.gradientProgram, 'u_input'), 0);
                    gl.uniform2f(gl.getUniformLocation(res.gradientProgram, 'u_resolution'), width, height);
                    drawQuad(gl, res.quadVAO);
                    // Tensor pass: additively blend this channel's tensor into the accumulator.
                    gl.enable(gl.BLEND);
                    gl.blendFunc(gl.ONE, gl.ONE);
                    gl.blendEquation(gl.FUNC_ADD);
                    gl.bindFramebuffer(gl.FRAMEBUFFER, tensorAccumFB.fb);
                    gl.useProgram(res.structureTensorProgram);
                    gl.activeTexture(gl.TEXTURE0);
                    gl.bindTexture(gl.TEXTURE_2D, gradientFB.tex);
                    gl.uniform1i(gl.getUniformLocation(res.structureTensorProgram, 'u_gradients'), 0);
                    drawQuad(gl, res.quadVAO);
                }
            }
            finally {
                gl.disable(gl.BLEND);
                for (const tex of channelTextures) {
                    gl.deleteTexture(tex);
                }
            }
            // Step 3: finalize magnitude from the combined trace, once, now
            // that every channel has been additively blended into tensorAccumFB.
            gl.bindFramebuffer(gl.FRAMEBUFFER, tensorFinalizedFB.fb);
            gl.useProgram(res.finalizeMagnitudeProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tensorAccumFB.tex);
            gl.uniform1i(gl.getUniformLocation(res.finalizeMagnitudeProgram, 'u_tensor'), 0);
            drawQuad(gl, res.quadVAO);
            // Step 4: Gaussian blur the finalized (E, F, G, mag) tensor:
            // blurring all four components together keeps magnitude aligned
            // with the smoothed tensor that tangent_extract will read.
            const smoothSigma = sigmaC ?? (cfg.kernelSize / 2.45);
            const radius = Math.min(16, Math.ceil(smoothSigma * 2.45));
            const kernelSize = radius * 2 + 1;
            const kernel = generateGaussianKernel$1(smoothSigma, kernelSize);
            gl.bindFramebuffer(gl.FRAMEBUFFER, blurTempFB.fb);
            gl.useProgram(res.gaussianBlurHProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tensorFinalizedFB.tex); // was tensorAccumFB.tex
            gl.uniform1i(gl.getUniformLocation(res.gaussianBlurHProgram, 'u_input'), 0);
            gl.uniform2f(gl.getUniformLocation(res.gaussianBlurHProgram, 'u_resolution'), width, height);
            gl.uniform1fv(gl.getUniformLocation(res.gaussianBlurHProgram, 'u_kernel'), kernel);
            gl.uniform1i(gl.getUniformLocation(res.gaussianBlurHProgram, 'u_kernelSize'), kernelSize);
            gl.uniform1i(gl.getUniformLocation(res.gaussianBlurHProgram, 'u_radius'), radius);
            drawQuad(gl, res.quadVAO);
            gl.bindFramebuffer(gl.FRAMEBUFFER, blurOutputFB.fb);
            gl.useProgram(res.gaussianBlurVProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, blurTempFB.tex);
            gl.uniform1i(gl.getUniformLocation(res.gaussianBlurVProgram, 'u_input'), 0);
            gl.uniform2f(gl.getUniformLocation(res.gaussianBlurVProgram, 'u_resolution'), width, height);
            gl.uniform1fv(gl.getUniformLocation(res.gaussianBlurVProgram, 'u_kernel'), kernel);
            gl.uniform1i(gl.getUniformLocation(res.gaussianBlurVProgram, 'u_kernelSize'), kernelSize);
            gl.uniform1i(gl.getUniformLocation(res.gaussianBlurVProgram, 'u_radius'), radius);
            drawQuad(gl, res.quadVAO);
            // Step 5: Extract initial tangent field
            gl.bindFramebuffer(gl.FRAMEBUFFER, tangentFB1.fb);
            gl.useProgram(res.tangentExtractProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, blurOutputFB.tex);
            gl.uniform1i(gl.getUniformLocation(res.tangentExtractProgram, 'u_tensor'), 0);
            drawQuad(gl, res.quadVAO);
            let readFB = tangentFB1;
            let writeFB = tangentFB2;
            for (let i = 0; i < cfg.iterations; i++) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, writeFB.fb);
                gl.useProgram(res.tangentRefineProgram);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, readFB.tex);
                gl.uniform1i(gl.getUniformLocation(res.tangentRefineProgram, 'u_tangents'), 0);
                gl.uniform2f(gl.getUniformLocation(res.tangentRefineProgram, 'u_resolution'), width, height);
                drawQuad(gl, res.quadVAO);
                // Swap
                [readFB, writeFB] = [writeFB, readFB];
            }
            // Read back results
            gl.bindFramebuffer(gl.FRAMEBUFFER, readFB.fb);
            const pixels = new Float32Array(width * height * 4);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixels);
            const tangents = new Array(width * height);
            const magnitude = new Float32Array(width * height);
            const anisotropy = new Float32Array(width * height);
            for (let i = 0; i < width * height; i++) {
                tangents[i] = { x: pixels[i * 4], y: pixels[i * 4 + 1] };
                magnitude[i] = pixels[i * 4 + 2];
                anisotropy[i] = pixels[i * 4 + 3];
            }
            // Cleanup temporary resources (channel textures already freed above)
            deleteFramebuffer(gl, gradientFB);
            deleteFramebuffer(gl, tensorAccumFB);
            deleteFramebuffer(gl, tensorFinalizedFB);
            deleteFramebuffer(gl, blurTempFB);
            deleteFramebuffer(gl, blurOutputFB);
            deleteFramebuffer(gl, tangentFB1);
            deleteFramebuffer(gl, tangentFB2);
            return TangentFlowField.fromVec2Array(tangents, width, height, magnitude, anisotropy);
        });
    }
    /**
     * Release WebGL resources held by this computer (programs, VAO/VBO,
     * and implicitly the canvas/context). Safe to call multiple times.
     */
    dispose() {
        if (this.resources) {
            const { gl } = this.resources;
            gl.deleteProgram(this.resources.gradientProgram);
            gl.deleteProgram(this.resources.structureTensorProgram);
            gl.deleteProgram(this.resources.gaussianBlurHProgram);
            gl.deleteProgram(this.resources.gaussianBlurVProgram);
            gl.deleteProgram(this.resources.tangentExtractProgram);
            gl.deleteProgram(this.resources.tangentRefineProgram);
            gl.deleteVertexArray(this.resources.quadVAO);
            gl.deleteBuffer(this.resources.quadVBO);
            this.resources = null;
        }
    }
    /**
     * Initialize WebGL resources (lazy initialization)
     */
    initResources(width, height) {
        if (this.resources) {
            // Resize canvas if needed
            const canvas = this.resources.canvas;
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }
            return this.resources;
        }
        const canvas = typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(width, height)
            : document.createElement('canvas');
        if (!(canvas instanceof OffscreenCanvas)) {
            canvas.width = width;
            canvas.height = height;
        }
        const gl = canvas.getContext('webgl2', {
            antialias: false,
            depth: false,
            stencil: false,
            preserveDrawingBuffer: false,
        });
        if (!gl) {
            throw new Error('WebGL2 not supported');
        }
        // Enable float textures
        gl.getExtension('EXT_color_buffer_float');
        gl.getExtension('OES_texture_float_linear');
        // Create shader programs
        const gradientProgram = createProgram$3(gl, source$s, source$r);
        const structureTensorProgram = createProgram$3(gl, source$s, source$q);
        const gaussianBlurHProgram = createProgram$3(gl, source$s, source$p);
        const gaussianBlurVProgram = createProgram$3(gl, source$s, source$o);
        const tangentExtractProgram = createProgram$3(gl, source$s, source$n);
        const tangentRefineProgram = createProgram$3(gl, source$s, source$m);
        const finalizeMagnitudeProgram = createProgram$3(gl, source$s, source$l);
        // Create fullscreen quad
        const quadVAO = gl.createVertexArray();
        const quadVBO = gl.createBuffer();
        gl.bindVertexArray(quadVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1,
            -1, 1, 1, -1, 1, 1,
        ]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
        this.resources = {
            gl,
            canvas,
            gradientProgram,
            structureTensorProgram,
            gaussianBlurHProgram,
            gaussianBlurVProgram,
            tangentExtractProgram,
            tangentRefineProgram,
            finalizeMagnitudeProgram,
            quadVAO,
            quadVBO,
        };
        return this.resources;
    }
}
// ============== Helper Functions ==============
function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Shader compile error: ${info}`);
    }
    return shader;
}
function createProgram$3(gl, vertSrc, fragSrc) {
    const vert = createShader(gl, gl.VERTEX_SHADER, vertSrc);
    const frag = createShader(gl, gl.FRAGMENT_SHADER, fragSrc);
    const program = gl.createProgram();
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`Program link error: ${info}`);
    }
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    return program;
}
function createTexture(gl, width, height, internalFormat, format, data) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, gl.FLOAT, data ?? null);
    return tex;
}
function createFramebuffer$1(gl, width, height, internalFormat) {
    const tex = createTexture(gl, width, height, internalFormat, gl.RGBA, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`Framebuffer incomplete: ${status}`);
    }
    return { fb, tex };
}
function deleteFramebuffer(gl, fb) {
    gl.deleteFramebuffer(fb.fb);
    gl.deleteTexture(fb.tex);
}
function drawQuad(gl, vao) {
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
}

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
/**
 * CPU-backed ETFComputer. Synchronous under the hood, but exposes the
 * same async ETFComputer contract as the WebGL/WebGPU backends so callers
 * can swap implementations without caring which one they have.
 */
class CpuEdgeTangentFlowComputer extends BaseCPUStrategy {
    async compute(input, config = {}, sigmaC) {
        const channelTensor = computeChannelTensor(input);
        return buildFlowField(channelTensor, input.width, input.height, config, sigmaC);
    }
    async computeMultiChannel(inputs, config = {}, sigmaC) {
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
 *
 * Magnitude and anisotropy are baked directly into the returned
 * TangentFlowField rather than surfaced as separate sibling results.
 */
function buildFlowField(channelTensor, width, height, config, sigmaC) {
    const cfg = { ...DEFAULT_ETF_CONFIG, ...config };
    const smoothSigma = sigmaC ?? (cfg.kernelSize / 2.45);
    const smoothedTensor = smoothStructureTensorGaussian(channelTensor.tensor, width, height, smoothSigma);
    let tangents = extractTangentField(smoothedTensor, width, height);
    for (let i = 0; i < cfg.iterations; i++) {
        tangents = refineTangentField(tangents, channelTensor.magnitude, width, height);
    }
    // Derived from the same (blurred) tensor extractTangentField() used for
    // its eigenvectors, so it lines up with the flow field refine() starts
    // from since refine only perturbs direction, not the tensor anisotropy reflects.
    const anisotropy = tensorAnisotropy(smoothedTensor, width * height);
    return TangentFlowField.fromVec2Array(tangents, width, height, channelTensor.magnitude, anisotropy);
}
/**
 * (lambda1-lambda2)/(lambda1+lambda2) in [0,1]. 1 = coherent line
 * direction, 0 = isotropic (flat region, corner, or texture noise where
 * local gradients disagree). Mirrors tensorMagnitude() in composing
 * correctly whether `tensor` came from one channel or a Di
 * Zenzo-summed multi-channel combination.
 */
function tensorAnisotropy(tensor, size) {
    const anisotropy = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        const e = tensor.e[i];
        const f = tensor.f[i];
        const g = tensor.g[i];
        const trace = e + g;
        if (trace > 1e-8) {
            const diff = e - g;
            anisotropy[i] = Math.sqrt(diff * diff + 4 * f * f) / trace;
        }
    }
    return anisotropy;
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
 * trace-derived magnitude are all additive across channels, which is
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
    const magnitude = tensorMagnitude({ e, g }, size);
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
    const kernel = generateGaussianKernel$1(sigma, kernelSize);
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

/**
 * Edge Tangent Flow computer that automatically resolves to the best
 * supported backend, with graceful single-retry fallback if that backend
 * fails after selection (driver crash, lost context, etc).
 *
 */
class EdgeTangentFlowComputer {
    instance;
    currentCtor;
    failedBackends = new Set();
    constructor(instance, currentCtor) {
        this.instance = instance;
        this.currentCtor = currentCtor;
    }
    static candidates = [
        WebGpuEdgeTangentFlowComputer,
        WebGLEdgeTangentFlowComputer,
        CpuEdgeTangentFlowComputer,
    ];
    static async create() {
        for (const Ctor of EdgeTangentFlowComputer.candidates) {
            if (await Ctor.isSupported()) {
                try {
                    return new EdgeTangentFlowComputer(new Ctor(), Ctor);
                }
                catch {
                    continue; // isSupported() lied
                }
            }
        }
        throw new Error('No supported ETF computer implementation available');
    }
    /**
     * Which backend is actually running right now. Can change over the
     * life of this instance if a fallback occurs mid-session.
     */
    get backend() {
        return this.instance.backend;
    }
    dispose() {
        this.instance.dispose();
    }
    /**
     * Compute an Edge Tangent Flow. The returned FlowField carries its own
     * magnitude/anisotropy (see interfaces/base.ts)
     */
    async compute(input, config = {}, sigmaC) {
        return this.callWithFallback(computer => computer.compute(input, config, sigmaC));
    }
    async computeMultiChannel(inputs, config = {}, sigmaC) {
        return this.callWithFallback(computer => computer.computeMultiChannel(inputs, config, sigmaC));
    }
    async callWithFallback(op) {
        let current = this.instance;
        while (true) {
            try {
                console.log(`${this.constructor.name}: Running ${current.backend}`);
                return await op(this.instance);
            }
            catch (err) {
                console.warn(`${this.constructor.name}: [${this.currentCtor.name}] process() failed, attempting fallback:`, err);
                const fallback = await this.demoteAndFindNext();
                if (!fallback)
                    throw err;
                current = fallback;
            }
        }
    }
    async demoteAndFindNext() {
        this.failedBackends.add(this.currentCtor);
        this.instance.dispose();
        for (const Ctor of EdgeTangentFlowComputer.candidates) {
            if (this.failedBackends.has(Ctor))
                continue;
            if (await Ctor.isSupported()) {
                try {
                    this.instance = new Ctor();
                    this.currentCtor = Ctor;
                    console.warn(`Falling back to ${Ctor.name}`);
                    return this.instance;
                }
                catch (err) {
                    console.warn(`[${Ctor.name}] construction failed despite isSupported():`, err);
                    this.failedBackends.add(Ctor); // isSupported() lied
                }
            }
        }
        return null;
    }
}

/**
 * ScalarField constructors and combinators.
 *
 * The type itself (`{ sample(i): number }`) lives in interfaces/base.ts
 * alongside ChannelImage, since it's a core data shape used across the
 * public API. This module is the equivalent of createChannelImage() for
 * that type: the runtime helpers for building and composing fields.
 *
 * Composition (map/blend/scale) is free until sampled. No intermediate
 * buffer is allocated unless you call materialize(). This matters because
 * DoGConfig's p/epsilon/phi are ScalarFields evaluated once per pixel
 * inside processor.ts's hot loops; building a config like
 * `ScalarField.blend(a, b, confidence)` doesn't cost anything up front.
 */
const ScalarField = {
    /** A field that returns the same value everywhere. Replaces the old
     *  bare `number` half of the `number | ChannelImage` union: every
     *  literal default (e.g. p=20) becomes `ScalarField.constant(20)`. */
    constant(value) {
        return { sample: () => value };
    },
    /** Wrap an existing per-pixel buffer as a field. Replaces the old
     *  `ChannelImage` half of the union. */
    fromChannelImage(img) {
        return { sample: (i) => img.data[i] };
    },
    /** Pointwise transform. */
    map(field, fn) {
        return { sample: (i) => fn(field.sample(i)) };
    },
    /** Linear interpolation per pixel: weight=1 -> fully `a`, weight=0 ->
     *  fully `b`. This is the core operation behind confidence-weighting --
     *  e.g. `blend(flowSmoothed, raw, anisotropy)` trusts the flow-smoothed
     *  value only where the tangent direction is reliable. */
    blend(a, b, weight) {
        return {
            sample: (i) => {
                const w = weight.sample(i);
                return w * a.sample(i) + (1 - w) * b.sample(i);
            },
        };
    },
    /** Pointwise multiply. */
    scale(field, factor) {
        return { sample: (i) => field.sample(i) * factor.sample(i) };
    },
    /** Force evaluation into a flat buffer -- needed when a downstream
     *  consumer (e.g. a GPU backend that wants a real texture, not a
     *  per-pixel JS callback) can't work with a lazy field directly. */
    materialize(field, width, height) {
        const out = createChannelImage$1(width, height);
        const size = width * height;
        for (let i = 0; i < size; i++)
            out.data[i] = field.sample(i);
        return out;
    },
};
// The ScalarField *type* is declared in interfaces/base.ts (it's a core
// data shape, alongside ChannelImage/FlowField); the local `interface
// ScalarField extends BaseScalarField {}` above just re-surfaces it under
// this module's own export table. Callers can do either
//   import { ScalarField } from '.../interfaces/base.js'        // type only
//   import { ScalarField } from '.../utils/scalar-field.js'     // type + helpers
// from whichever module they're already pulling from.
/**
 * Bridge a FlowField's raw magnitude into a [0,1] ScalarField, normalized
 * against the field's own maximum. Raw magnitude has no fixed scale (it
 * depends on input contrast), so almost every consumer wants this rather
 * than getMagnitude() directly.
 *
 * Note: this does one O(width*height) pass up front to find the max, then
 * samples are O(1). If you need this for the same FlowField repeatedly,
 * compute it once and reuse the returned field.
 */
function normalizedMagnitudeField(flow) {
    const { width, height } = flow;
    const size = width * height;
    let max = 1e-6;
    for (let i = 0; i < size; i++) {
        max = Math.max(max, flow.getMagnitude(i % width, (i / width) | 0));
    }
    return {
        sample: (i) => flow.getMagnitude(i % width, (i / width) | 0) / max,
    };
}
/** Bridge a FlowField's per-pixel anisotropy into a ScalarField. Already
 *  in [0,1], no normalization needed. */
function anisotropyField(flow) {
    const { width } = flow;
    return {
        sample: (i) => flow.getAnisotropy(i % width, (i / width) | 0),
    };
}

/**
 * Gradient-aligned blur for FDoG
 *
 * This applies blur perpendicular to the flow direction (across edges).
 * Used for the DoG computation in FDoG, where we want to blur across
 * edges but not along them.
 */
class CPUGradientAlignedBlur extends BaseCPUStrategy {
    backend = 'cpu';
    config;
    flowField;
    constructor(config) {
        super();
        this.flowField = config.flowField;
        this.config = { ...DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG, ...config };
    }
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
        const output = createChannelImage$1(input.width, input.height);
        // Number of samples perpendicular to flow
        const halfSamples = Math.ceil(sigma * 2 / this.config.stepSize);
        const numSamples = halfSamples * 2 + 1;
        const weights = generateGaussianKernel$1(sigma, numSamples);
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

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: blur/shaders/gradient-aligned/webgl2-fragment.glsl
// Regenerate with `npm run build:shaders`.
const source$k = `#version 300 es
precision highp float;

#define MAX_SAMPLES \${MAX_SAMPLES}

uniform sampler2D u_input;
uniform sampler2D u_flowDir;
uniform vec2 u_resolution;
uniform int u_halfSamples;
uniform float u_stepSize;
uniform float u_weights[MAX_SAMPLES];

out vec4 outColor;

// Manual bilinear + clamp-to-edge, matching utils/getPixelBilinear exactly.
// We do this ourselves (via texelFetch) rather than relying on hardware
// LINEAR filtering, because WebGL2 doesn't guarantee linear filtering for
// 32-bit float textures without the OES_texture_float_linear extension.
float fetchClamped(sampler2D tex, int x, int y, int w, int h) {
  int cx = clamp(x, 0, w - 1);
  int cy = clamp(y, 0, h - 1);
  return texelFetch(tex, ivec2(cx, cy), 0).r;
}

float sampleBilinear(sampler2D tex, float x, float y, int w, int h) {
  int x0 = int(floor(x));
  int y0 = int(floor(y));
  int x1 = x0 + 1;
  int y1 = y0 + 1;
  float fx = x - float(x0);
  float fy = y - float(y0);
  float v00 = fetchClamped(tex, x0, y0, w, h);
  float v10 = fetchClamped(tex, x1, y0, w, h);
  float v01 = fetchClamped(tex, x0, y1, w, h);
  float v11 = fetchClamped(tex, x1, y1, w, h);
  return v00 * (1.0 - fx) * (1.0 - fy) + v10 * fx * (1.0 - fy)
       + v01 * (1.0 - fx) * fy + v11 * fx * fy;
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  int w = int(u_resolution.x);
  int h = int(u_resolution.y);
  float px0 = float(px.x);
  float py0 = float(px.y);

  // Flow direction is only ever sampled at integer pixel centers on the
  // CPU path (no bilinear there), so texelFetch (nearest) is correct here.
  vec2 dir = texelFetch(u_flowDir, px, 0).rg;

  int center = u_halfSamples;
  float sum = sampleBilinear(u_input, px0, py0, w, h) * u_weights[center];
  float weightSum = u_weights[center];

  // Positive gradient direction
  for (int i = 1; i <= MAX_SAMPLES; i++) {
    if (i > u_halfSamples) break;
    float fx = px0 + dir.x * u_stepSize * float(i);
    float fy = py0 + dir.y * u_stepSize * float(i);
    if (fx < -0.5 || fx > u_resolution.x - 0.5 || fy < -0.5 || fy > u_resolution.y - 0.5) {
      break;
    }
    float wgt = u_weights[center + i];
    sum += sampleBilinear(u_input, fx, fy, w, h) * wgt;
    weightSum += wgt;
  }

  // Negative gradient direction
  for (int i = 1; i <= MAX_SAMPLES; i++) {
    if (i > u_halfSamples) break;
    float fx = px0 - dir.x * u_stepSize * float(i);
    float fy = py0 - dir.y * u_stepSize * float(i);
    if (fx < -0.5 || fx > u_resolution.x - 0.5 || fy < -0.5 || fy > u_resolution.y - 0.5) {
      break;
    }
    float wgt = u_weights[center - i];
    sum += sampleBilinear(u_input, fx, fy, w, h) * wgt;
    weightSum += wgt;
  }

  float result = weightSum > 0.0 ? sum / weightSum : 0.0;
  outColor = vec4(result, 0.0, 0.0, 1.0);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: blur/shaders/gradient-aligned/vertex.glsl
// Regenerate with `npm run build:shaders`.
const source$j = `#version 300 es
layout(location = 0) in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/**
 * WebGL2-accelerated gradient-aligned blur for FDoG
 *
 * Runs the exact same perpendicular-to-flow sampling as
 * CPUGradientAlignedBlur, but as a single fullscreen-quad fragment shader
 * pass on the GPU instead of a per-pixel JS loop.
 *
 */
// Must match the unrolled loop bound in FRAGMENT_SOURCE.
const MAX_SAMPLES$1 = 256;
function compileShader$2(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`[GradientAlignedBlur/WebGL] Shader compile error: ${info}`);
    }
    return shader;
}
function createProgram$2(gl, vsSrc, fsSrc) {
    const vs = compileShader$2(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compileShader$2(gl, gl.FRAGMENT_SHADER, fsSrc);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`[GradientAlignedBlur/WebGL] Program link error: ${info}`);
    }
    return program;
}
/**
 * Creates a throwaway canvas + WebGL2 context to check capability, without
 * touching any live instance state. Used by both `isSupported()` and
 * `getUnsupportedReason()`which is cheap enough (one canvas + one context) that
 * we don't bother caching the result across calls.
 */
function probeWebGL2Support() {
    try {
        const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
        const gl = canvas.getContext('webgl2', { antialias: false });
        if (!gl) {
            return '[GradientAlignedBlur/WebGL] WebGL2 not available';
        }
        if (!gl.getExtension('EXT_color_buffer_float')) {
            gl.getExtension('WEBGL_lose_context')?.loseContext();
            return '[GradientAlignedBlur/WebGL] EXT_color_buffer_float not supported (required for R32F render targets)';
        }
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return undefined;
    }
    catch (err) {
        return `[GradientAlignedBlur/WebGL] probe threw: ${err instanceof Error ? err.message : String(err)}`;
    }
}
class WebGLGradientAlignedBlur {
    backend = 'webgl';
    config;
    gl;
    canvas;
    program;
    vao;
    inputTexture;
    flowTexture = null;
    flowFieldWidth = 0;
    flowFieldHeight = 0;
    flowDirty = true;
    fbo;
    outputTexture;
    fboWidth = 0;
    fboHeight = 0;
    uniforms = {};
    contextLost = false;
    flowField;
    constructor(config) {
        this.flowField = config.flowField;
        this.config = { ...DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG, ...config };
        const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
        const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false });
        if (!gl) {
            throw new Error('[GradientAlignedBlur/WebGL] WebGL2 not available');
        }
        if (!gl.getExtension('EXT_color_buffer_float')) {
            throw new Error('[GradientAlignedBlur/WebGL] EXT_color_buffer_float not supported (required for R32F render targets)');
        }
        canvas.addEventListener('webglcontextlost', (event) => {
            event.preventDefault();
            this.contextLost = true;
            console.warn('[GradientAlignedBlur/WebGL] context lost');
        });
        this.canvas = canvas;
        this.gl = gl;
        this.program = createProgram$2(gl, source$j, source$k);
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);
        const quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        // Two triangles covering clip space [-1, 1]
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
        this.inputTexture = gl.createTexture();
        this.setupTextureParams(this.inputTexture);
        this.outputTexture = gl.createTexture();
        this.fbo = gl.createFramebuffer();
        gl.useProgram(this.program);
        ['u_input', 'u_flowDir', 'u_resolution', 'u_halfSamples', 'u_stepSize', 'u_weights'].forEach((name) => {
            this.uniforms[name] = gl.getUniformLocation(this.program, name);
        });
        gl.uniform1i(this.uniforms['u_input'], 0);
        gl.uniform1i(this.uniforms['u_flowDir'], 1);
    }
    static async isSupported() {
        return probeWebGL2Support() === undefined;
    }
    static async getUnsupportedReason() {
        return probeWebGL2Support();
    }
    setupTextureParams(tex) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    setFlowField(flowField) {
        this.flowField = flowField;
        this.flowDirty = true;
    }
    dispose() {
        const gl = this.gl;
        gl.deleteTexture(this.inputTexture);
        gl.deleteTexture(this.outputTexture);
        if (this.flowTexture)
            gl.deleteTexture(this.flowTexture);
        gl.deleteFramebuffer(this.fbo);
        gl.deleteProgram(this.program);
        gl.deleteVertexArray(this.vao);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    ensureFbo(width, height) {
        if (this.fboWidth === width && this.fboHeight === height)
            return;
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.outputTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, null);
        this.setupTextureParams(this.outputTexture);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outputTexture, 0);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error(`[GradientAlignedBlur/WebGL] Framebuffer incomplete: 0x${status.toString(16)}`);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.fboWidth = width;
        this.fboHeight = height;
    }
    bakeFlowTexture(width, height) {
        const gl = this.gl;
        const data = new Float32Array(width * height * 2);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const tangent = this.flowField.getTangent(x, y);
                const idx = (y * width + x) * 2;
                data[idx] = -tangent.y; // perpendicular.x
                data[idx + 1] = tangent.x; // perpendicular.y
            }
        }
        if (!this.flowTexture)
            this.flowTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.flowTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, width, height, 0, gl.RG, gl.FLOAT, data);
        this.setupTextureParams(this.flowTexture);
        this.flowFieldWidth = width;
        this.flowFieldHeight = height;
        this.flowDirty = false;
    }
    async blur(input, sigma) {
        if (this.contextLost || this.gl.isContextLost()) {
            throw new Error('[GradientAlignedBlur/WebGL] context lost');
        }
        if (sigma < 0.1) {
            return { data: new Float32Array(input.data), width: input.width, height: input.height };
        }
        const gl = this.gl;
        const { width, height } = input;
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        gl.viewport(0, 0, width, height);
        if (this.flowDirty || this.flowFieldWidth !== width || this.flowFieldHeight !== height) {
            this.bakeFlowTexture(width, height);
        }
        this.ensureFbo(width, height);
        const halfSamples = Math.min(MAX_SAMPLES$1 - 1, Math.ceil((sigma * 2) / this.config.stepSize));
        const numSamples = halfSamples * 2 + 1;
        const weights = generateGaussianKernel$1(sigma, numSamples);
        const paddedWeights = new Float32Array(MAX_SAMPLES$1);
        paddedWeights.set(weights);
        const tUpload = performance.now();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.inputTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, input.data);
        console.log(`[GradientAlignedBlur/WebGL] Upload input texture: ${(performance.now() - tUpload).toFixed(2)}ms`);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.flowTexture);
        gl.useProgram(this.program);
        gl.uniform2f(this.uniforms['u_resolution'], width, height);
        gl.uniform1i(this.uniforms['u_halfSamples'], halfSamples);
        gl.uniform1f(this.uniforms['u_stepSize'], this.config.stepSize);
        gl.uniform1fv(this.uniforms['u_weights'], paddedWeights);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        const output = createChannelImage$1(width, height);
        gl.readPixels(0, 0, width, height, gl.RED, gl.FLOAT, output.data);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return output;
    }
}

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: blur/shaders/gradient-aligned/webgpu-fragment.wgsl
// Regenerate with `npm run build:shaders`.
const source$i = `struct Params {
  width: u32,
  height: u32,
  halfSamples: u32,
  stepSize: f32,
  rowOffset: u32,   // first global row this dispatch is responsible for
  tileHeight: u32,  // number of rows in this tile's output buffer
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
// max samples must match MAX_SAMPLES
@group(0) @binding(1) var<storage, read> weights: array<f32, 256>;
@group(0) @binding(2) var inputTex: texture_2d<f32>;
@group(0) @binding(3) var flowTex: texture_2d<f32>;
@group(0) @binding(4) var<storage, read_write> output: array<f32>;

fn fetchClamped(tex: texture_2d<f32>, x: i32, y: i32, w: i32, h: i32) -> f32 {
  let cx = clamp(x, 0, w - 1);
  let cy = clamp(y, 0, h - 1);
  return textureLoad(tex, vec2<i32>(cx, cy), 0).r;
}

fn sampleBilinear(tex: texture_2d<f32>, x: f32, y: f32, w: i32, h: i32) -> f32 {
  let x0 = i32(floor(x));
  let y0 = i32(floor(y));
  let x1 = x0 + 1;
  let y1 = y0 + 1;
  let fx = x - f32(x0);
  let fy = y - f32(y0);
  let v00 = fetchClamped(tex, x0, y0, w, h);
  let v10 = fetchClamped(tex, x1, y0, w, h);
  let v01 = fetchClamped(tex, x0, y1, w, h);
  let v11 = fetchClamped(tex, x1, y1, w, h);
  return v00 * (1.0 - fx) * (1.0 - fy) + v10 * fx * (1.0 - fy)
       + v01 * (1.0 - fx) * fy + v11 * fx * fy;
}

// workgroup_sizes must match WORKGROUP_SIZE
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = i32(params.width);
  let h = i32(params.height);
  let localY = i32(gid.y);
  // Bounds-check against this tile's height (buffer is sized per-tile,
  // not per-image) before doing anything else.
  if (i32(gid.x) >= w || localY >= i32(params.tileHeight)) {
    return;
  }
  let globalY = localY + i32(params.rowOffset);
  if (globalY >= h) {
    return;
  }

  let px0 = f32(gid.x);
  let py0 = f32(globalY);
  // Flow direction only ever sampled at integer pixel centers on the CPU
  // path, so nearest-load (no interpolation) is correct here.
  let dir = textureLoad(flowTex, vec2<i32>(i32(gid.x), globalY), 0).rg;

  let center = i32(params.halfSamples);
  var sum = sampleBilinear(inputTex, px0, py0, w, h) * weights[center];
  var weightSum = weights[center];

  var i: i32 = 1;
  loop {
    if (i > i32(params.halfSamples)) { break; }
    let fx = px0 + dir.x * params.stepSize * f32(i);
    let fy = py0 + dir.y * params.stepSize * f32(i);
    if (fx < -0.5 || fx > f32(w) - 0.5 || fy < -0.5 || fy > f32(h) - 0.5) { break; }
    let wgt = weights[center + i];
    sum = sum + sampleBilinear(inputTex, fx, fy, w, h) * wgt;
    weightSum = weightSum + wgt;
    i = i + 1;
  }

  i = 1;
  loop {
    if (i > i32(params.halfSamples)) { break; }
    let fx = px0 - dir.x * params.stepSize * f32(i);
    let fy = py0 - dir.y * params.stepSize * f32(i);
    if (fx < -0.5 || fx > f32(w) - 0.5 || fy < -0.5 || fy > f32(h) - 0.5) { break; }
    let wgt = weights[center - i];
    sum = sum + sampleBilinear(inputTex, fx, fy, w, h) * wgt;
    weightSum = weightSum + wgt;
    i = i + 1;
  }

  let result = select(0.0, sum / weightSum, weightSum > 0.0);
  output[u32(localY) * params.width + gid.x] = result;
}`;

/**
 * WebGPU-accelerated gradient-aligned blur for FDoG
 *
 * Compute-shader version of the same perpendicular-to-flow sampling as
 * CPUGradientAlignedBlur / WebGLGradientAlignedBlur.
 *
 */
const MAX_SAMPLES = 256;
const WORKGROUP_SIZE$1 = 8;
class WebGPUGradientAlignedBlur {
    backend = 'webgpu';
    config;
    device;
    pipeline;
    flowField;
    static cachedDevice = null;
    static deviceInitPromise = null;
    static lastUnsupportedReason;
    static errorListenerAttached = false;
    flowTexture = null;
    flowFieldWidth = 0;
    flowFieldHeight = 0;
    flowDirty = true;
    flowBakePromise = null;
    maxTileBytes = 0;
    static CPU_BAKE_ROWS_PER_CHUNK = 512;
    static TILE_MEMORY_SAFETY_FACTOR = 0.5;
    constructor(config) {
        const device = WebGPUGradientAlignedBlur.cachedDevice;
        if (!device) {
            throw new Error('[GradientAlignedBlur/WebGPU] No cached GPUDevice. isSupported() must resolve true before construction.');
        }
        this.flowField = config.flowField;
        this.device = device;
        this.config = { ...DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG, ...config };
        this.initPipeline();
        const limits = this.device.limits;
        this.maxTileBytes = Math.max(WORKGROUP_SIZE$1 * 4, // never go below one row's worth of data
        Math.floor(Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize) *
            WebGPUGradientAlignedBlur.TILE_MEMORY_SAFETY_FACTOR));
        if (!WebGPUGradientAlignedBlur.errorListenerAttached) {
            WebGPUGradientAlignedBlur.errorListenerAttached = true;
            this.device.addEventListener('uncapturederror', (event) => {
                console.error('[GradientAlignedBlur/WebGPU] uncaptured GPU error:', event.error?.message ?? event.error);
            });
        }
    }
    /**
     * Acquires (and caches) the shared GPUDevice. Concurrent callers await
     * the same in-flight request rather than each requesting their own
     * adapter/device. Re-acquires automatically after a `device.lost` clears
     * the cache.
     */
    static async acquireDevice() {
        if (WebGPUGradientAlignedBlur.cachedDevice) {
            return WebGPUGradientAlignedBlur.cachedDevice;
        }
        if (WebGPUGradientAlignedBlur.deviceInitPromise) {
            return WebGPUGradientAlignedBlur.deviceInitPromise;
        }
        WebGPUGradientAlignedBlur.deviceInitPromise = (async () => {
            if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
                throw new Error('[GradientAlignedBlur/WebGPU] navigator.gpu unavailable');
            }
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                throw new Error('[GradientAlignedBlur/WebGPU] No adapter available');
            }
            // Explicitly request the adapter's actual max limits rather than
            // accepting the (often much lower) spec-minimum defaults (e.g. the
            // default maxBufferSize/maxStorageBufferBindingSize are commonly
            // 256MB/128MB, but many adapters support several times that).
            const device = await adapter.requestDevice({
                requiredLimits: {
                    maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
                },
            });
            device.lost.then((info) => {
                console.warn('[GradientAlignedBlur/WebGPU] device lost:', info.message);
                if (WebGPUGradientAlignedBlur.cachedDevice === device) {
                    WebGPUGradientAlignedBlur.cachedDevice = null;
                    WebGPUGradientAlignedBlur.errorListenerAttached = false;
                }
            });
            WebGPUGradientAlignedBlur.cachedDevice = device;
            return device;
        })();
        try {
            return await WebGPUGradientAlignedBlur.deviceInitPromise;
        }
        finally {
            WebGPUGradientAlignedBlur.deviceInitPromise = null;
        }
    }
    static async isSupported() {
        try {
            await WebGPUGradientAlignedBlur.acquireDevice();
            return true;
        }
        catch (err) {
            WebGPUGradientAlignedBlur.lastUnsupportedReason =
                err instanceof Error ? err.message : String(err);
            return false;
        }
    }
    static getUnsupportedReason() {
        return WebGPUGradientAlignedBlur.lastUnsupportedReason;
    }
    initPipeline() {
        const module = this.device.createShaderModule({ code: source$i });
        this.pipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module, entryPoint: 'main' },
        });
    }
    setFlowField(flowField) {
        this.flowField = flowField;
        this.flowDirty = true;
    }
    assertWithinTextureLimits(width, height) {
        const maxDim = this.device.limits.maxTextureDimension2D;
        if (width > maxDim || height > maxDim) {
            throw new Error(`[GradientAlignedBlur/WebGPU] Image ${width}x${height} exceeds this device's ` +
                `maxTextureDimension2D (${maxDim}) on at least one axis. The input/flow textures ` +
                `are each a single full-image texture, so this can't be worked around by row-band ` +
                `tiling alone (that only bounds the output/readback buffers). Downscale the image, ` +
                `or split it into overlapping regions upstream and blur each region separately.`);
        }
    }
    /**
     * Releases this instance's own GPU resources (flow texture). Deliberately
     * does NOT destroy `this.device`. The device is shared/cached at the
     * class level (see file header), and other instances (or a future
     * instance created after a fallback-and-retry) may still be using it.
     * If you need to fully release the device (e.g. on app shutdown), that's
     * out of scope for a per-instance dispose() and would need an explicit
     * class-level teardown method instead.
     */
    dispose() {
        this.flowTexture?.destroy();
    }
    bakeFlowTexture(width, height) {
        this.assertWithinTextureLimits(width, height);
        const newTexture = this.device.createTexture({
            size: [width, height],
            format: 'rg32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        const rowsPerChunk = Math.max(1, WebGPUGradientAlignedBlur.CPU_BAKE_ROWS_PER_CHUNK);
        for (let y0 = 0; y0 < height; y0 += rowsPerChunk) {
            const rows = Math.min(rowsPerChunk, height - y0);
            const chunk = new Float32Array(width * rows * 2);
            for (let ry = 0; ry < rows; ry++) {
                const y = y0 + ry;
                for (let x = 0; x < width; x++) {
                    const tangent = this.flowField.getTangent(x, y);
                    const idx = (ry * width + x) * 2;
                    chunk[idx] = -tangent.y; // perpendicular.x
                    chunk[idx + 1] = tangent.x; // perpendicular.y
                }
            }
            this.device.queue.writeTexture({ texture: newTexture, origin: { x: 0, y: y0 } }, chunk, { bytesPerRow: width * 2 * 4, rowsPerImage: rows }, { width, height: rows });
        }
        const oldTexture = this.flowTexture;
        this.flowTexture = newTexture;
        oldTexture?.destroy();
        this.flowFieldWidth = width;
        this.flowFieldHeight = height;
        this.flowDirty = false;
        return newTexture;
    }
    /**
     * Returns the current flow texture for (width, height), baking it if
     * necessary. Guarded so that concurrent blur() calls with matching
     * dimensions await a single in-flight bake instead of each triggering
     * their own (which would otherwise race on `this.flowTexture`).
     */
    async getFlowTexture(width, height) {
        if (this.flowTexture &&
            !this.flowDirty &&
            this.flowFieldWidth === width &&
            this.flowFieldHeight === height) {
            return this.flowTexture;
        }
        if (this.flowBakePromise) {
            await this.flowBakePromise;
            return this.getFlowTexture(width, height);
        }
        this.flowBakePromise = (async () => this.bakeFlowTexture(width, height))();
        try {
            return await this.flowBakePromise;
        }
        finally {
            this.flowBakePromise = null;
        }
    }
    /**
     * Safe to call concurrently on the same instance (e.g.
     * `Promise.all([blur.blur(input, s1), blur.blur(input, s2)])`).
     * All GPU resources that are written-then-read per invocation are
     * allocated fresh here and destroyed before returning, so overlapping
     * calls never share mutable state. The only cross-call state is the
     * (read-only, cached) flow texture, obtained via `getFlowTexture`,
     * which is itself lock-guarded against concurrent re-baking.
     *
     * MEMORY: the output/readback path is processed in row-band tiles
     * bounded by `maxTileBytes`, not one whole-image buffer. This is what
     * keeps memory flat for large images (and for concurrent calls on the
     * same image) instead of scaling linearly with width*height.
     * The input/flow textures are still
     * one full-image texture each; if width or height exceeds the device's
     * maxTextureDimension2D, `getFlowTexture`/this method throw a clear
     * error rather than silently corrupting or crashing (see
     * `assertWithinTextureLimits`).
     */
    async blur(input, sigma) {
        if (WebGPUGradientAlignedBlur.cachedDevice !== this.device) {
            throw new Error('[GradientAlignedBlur/WebGPU] device lost');
        }
        if (sigma < 0.1) {
            return { data: new Float32Array(input.data), width: input.width, height: input.height };
        }
        const { width, height } = input;
        this.assertWithinTextureLimits(width, height);
        const flowTexture = await this.getFlowTexture(width, height);
        const wantedHalfSamples = Math.ceil((sigma * 2) / this.config.stepSize);
        const halfSamples = Math.min(MAX_SAMPLES - 1, wantedHalfSamples);
        if (wantedHalfSamples > MAX_SAMPLES - 1) {
            console.warn(`[GradientAlignedBlur/WebGPU] halfSamples clamped to ${MAX_SAMPLES - 1} (sigma=${sigma} wanted ${wantedHalfSamples}); kernel truncated. Raise MAX_SAMPLES if this matters.`);
        }
        const numSamples = halfSamples * 2 + 1;
        const weights = generateGaussianKernel$1(sigma, numSamples);
        const paddedWeights = new Float32Array(MAX_SAMPLES);
        paddedWeights.set(weights);
        // Row-band tile plan. Only the output/readback buffers scale with
        // tile size. input/flow textures below are still whole-image.
        const bytesPerRow = width * 4;
        const rowsPerTile = Math.max(1, Math.min(height, Math.floor(this.maxTileBytes / bytesPerRow)));
        const inputTexture = this.device.createTexture({
            size: [width, height],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        const tileBufferSize = rowsPerTile * bytesPerRow;
        const outputBuffer = this.device.createBuffer({
            size: tileBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        const readBuffer = this.device.createBuffer({
            size: tileBufferSize,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const paramsBuffer = this.device.createBuffer({
            size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const weightsBuffer = this.device.createBuffer({
            size: MAX_SAMPLES * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        try {
            this.device.queue.writeTexture({ texture: inputTexture }, input.data, { bytesPerRow, rowsPerImage: height }, { width, height });
            this.device.queue.writeBuffer(weightsBuffer, 0, paddedWeights);
            const bindGroup = this.device.createBindGroup({
                layout: this.pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: paramsBuffer } },
                    { binding: 1, resource: { buffer: weightsBuffer } },
                    { binding: 2, resource: inputTexture.createView() },
                    { binding: 3, resource: flowTexture.createView() },
                    { binding: 4, resource: { buffer: outputBuffer } },
                ],
            });
            const output = createChannelImage$1(width, height);
            for (let rowOffset = 0; rowOffset < height; rowOffset += rowsPerTile) {
                const tileHeight = Math.min(rowsPerTile, height - rowOffset);
                const paramsData = new ArrayBuffer(32);
                const paramsView = new DataView(paramsData);
                paramsView.setUint32(0, width, true);
                paramsView.setUint32(4, height, true);
                paramsView.setUint32(8, halfSamples, true);
                paramsView.setFloat32(12, this.config.stepSize, true);
                paramsView.setUint32(16, rowOffset, true);
                paramsView.setUint32(20, tileHeight, true);
                this.device.queue.writeBuffer(paramsBuffer, 0, paramsData);
                const encoder = this.device.createCommandEncoder();
                const pass = encoder.beginComputePass();
                pass.setPipeline(this.pipeline);
                pass.setBindGroup(0, bindGroup);
                pass.dispatchWorkgroups(Math.ceil(width / WORKGROUP_SIZE$1), Math.ceil(tileHeight / WORKGROUP_SIZE$1));
                pass.end();
                encoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, tileHeight * bytesPerRow);
                this.device.queue.submit([encoder.finish()]);
                await readBuffer.mapAsync(GPUMapMode.READ, 0, tileHeight * bytesPerRow);
                const mapped = readBuffer.getMappedRange(0, tileHeight * bytesPerRow);
                output.data.set(new Float32Array(mapped), rowOffset * width);
                readBuffer.unmap();
            }
            return output;
        }
        finally {
            // Always release per-call resources, even if a pass or readback
            // throws, so concurrent/repeated calls don't leak GPU memory.
            inputTexture.destroy();
            outputBuffer.destroy();
            readBuffer.destroy();
            paramsBuffer.destroy();
            weightsBuffer.destroy();
        }
    }
}

class GradientAlignedBlur {
    instance;
    currentCtor;
    flowField;
    config;
    failedBackends = new Set();
    constructor(instance, currentCtor, flowField, config) {
        this.instance = instance;
        this.currentCtor = currentCtor;
        this.flowField = flowField;
        this.config = config;
    }
    // Ordered best-to-worst. `satisfies` (not `implements`) catches a
    // backend missing isSupported() or the instance shape at this line.
    static candidates = [
        WebGPUGradientAlignedBlur,
        WebGLGradientAlignedBlur,
        CPUGradientAlignedBlur,
    ];
    static async create(flowField, config = {}) {
        for (const Ctor of GradientAlignedBlur.candidates) {
            if (await Ctor.isSupported()) {
                try {
                    const instance = new Ctor({ ...config, flowField });
                    return new GradientAlignedBlur(instance, Ctor, flowField, config);
                }
                catch {
                    continue; // isSupported() lied
                }
            }
        }
        throw new Error('No supported gradient-aligned blur implementation available');
    }
    get backend() {
        return this.instance.backend;
    }
    dispose() {
        this.instance.dispose();
    }
    async blur(input, sigma) {
        let current = this.instance;
        while (true) {
            try {
                console.log(`${this.constructor.name}: Running ${current.backend}`);
                return await current.blur(input, sigma);
            }
            catch (err) {
                console.warn(`${this.constructor.name}: [${this.currentCtor.name}] process() failed, attempting fallback:`, err);
                const fallback = await this.demoteAndFindNext();
                if (!fallback)
                    throw err;
                current = fallback;
            }
        }
    }
    /**
     * Propagates to whatever backend is currently running, and is also
     * remembered for any future backend constructed by demoteAndFindNext()
     * (fallback instances are built fresh via `new Ctor(config)`, so the
     * current flow field has to be threaded through `config` each time
     * rather than mutated on an existing instance).
     */
    setFlowField(flowField) {
        this.flowField = flowField;
        this.instance.setFlowField?.(flowField);
    }
    async demoteAndFindNext() {
        this.failedBackends.add(this.currentCtor);
        this.instance.dispose();
        for (const Ctor of GradientAlignedBlur.candidates) {
            if (this.failedBackends.has(Ctor))
                continue;
            if (await Ctor.isSupported()) {
                try {
                    console.warn(`Falling back to ${Ctor.name}`);
                    this.instance = new Ctor({ ...this.config, flowField: this.flowField });
                    this.currentCtor = Ctor;
                    return this.instance;
                }
                catch (err) {
                    console.warn(`[${Ctor.name}] construction failed despite isSupported():`, err);
                    this.failedBackends.add(Ctor);
                }
            }
        }
        return null;
    }
}

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: blur/shaders/flow-guided/webgl2-flow-blur.glsl
// Regenerate with `npm run build:shaders`.
const source$h = `/**
 * Fragment shader for flow-guided blur (WebGL2)
 * Uses line integral convolution along edge tangent directions
 */
#version 300 es
  precision highp float;
  
  uniform sampler2D u_image;
  uniform sampler2D u_flowField;
  uniform vec2 u_resolution;
  uniform float u_kernel[64];
  uniform int u_kernelSize;
  
  in vec2 v_texCoord;
  out vec4 fragColor;
  
  void main() {
    vec2 texelSize = 1.0 / u_resolution;
    int halfSize = u_kernelSize / 2;
    
    vec2 flow = texture(u_flowField, v_texCoord).rg * 2.0 - 1.0;
    
    float result = 0.0;
    float weightSum = 0.0;
    
    // Sample along positive flow direction
    vec2 pos = v_texCoord;
    for (int i = 0; i < 32; i++) {
      if (i > halfSize) break;
      int idx = halfSize + i;
      if (idx >= u_kernelSize) break;
      
      result += texture(u_image, pos).r * u_kernel[idx];
      weightSum += u_kernel[idx];
      
      vec2 localFlow = texture(u_flowField, pos).rg * 2.0 - 1.0;
      pos += localFlow * texelSize;
    }
    
    // Sample along negative flow direction
    pos = v_texCoord;
    for (int i = 1; i < 32; i++) {
      if (i > halfSize) break;
      int idx = halfSize - i;
      if (idx < 0) break;
      
      vec2 localFlow = texture(u_flowField, pos).rg * 2.0 - 1.0;
      pos -= localFlow * texelSize;
      
      result += texture(u_image, pos).r * u_kernel[idx];
      weightSum += u_kernel[idx];
    }
    
    result = weightSum > 0.0 ? result / weightSum : 0.0;
    fragColor = vec4(result, result, result, 1.0);
  }
`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: blur/shaders/flow-guided/webgl2-vertex.glsl
// Regenerate with `npm run build:shaders`.
const source$g = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
  
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: blur/shaders/flow-guided/webgpu-flow-blur.wgsl
// Regenerate with `npm run build:shaders`.
const source$f = `/**
 * WebGPU compute shader for flow-guided blur
 */
struct Params {
    width: u32,
    height: u32,
    kernelSize: u32,
    rowOffset: u32,   // first global row this dispatch is responsible for
    tileHeight: u32,  // number of rows in this tile's output buffer
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
  }
  
  @group(0) @binding(0) var<uniform> params: Params;
  @group(0) @binding(1) var<storage, read> kernel: array<f32>;
  @group(0) @binding(2) var inputTex: texture_2d<f32>;
  @group(0) @binding(3) var flowTex: texture_2d<f32>;
  @group(0) @binding(4) var<storage, read_write> output: array<f32>;
  
  fn fetchClamped(x: i32, y: i32, w: i32, h: i32) -> f32 {
    let cx = clamp(x, 0, w - 1);
    let cy = clamp(y, 0, h - 1);
    return textureLoad(inputTex, vec2<i32>(cx, cy), 0).r;
  }
  
  fn sampleBilinear(x: f32, y: f32, w: i32, h: i32) -> f32 {
    let x0 = i32(floor(x));
    let y0 = i32(floor(y));
    let x1 = x0 + 1;
    let y1 = y0 + 1;
    
    let fx = x - f32(x0);
    let fy = y - f32(y0);
    
    let v00 = fetchClamped(x0, y0, w, h);
    let v10 = fetchClamped(x1, y0, w, h);
    let v01 = fetchClamped(x0, y1, w, h);
    let v11 = fetchClamped(x1, y1, w, h);
    
    return v00 * (1.0 - fx) * (1.0 - fy) +
           v10 * fx * (1.0 - fy) +
           v01 * (1.0 - fx) * fy +
           v11 * fx * fy;
  }
  
  fn getTangent(x: f32, y: f32, w: i32, h: i32) -> vec2<f32> {
    let cx = clamp(i32(round(x)), 0, w - 1);
    let cy = clamp(i32(round(y)), 0, h - 1);
    return textureLoad(flowTex, vec2<i32>(cx, cy), 0).rg;
  }
  
  @compute @workgroup_size(16, 16)
  fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let w = i32(params.width);
    let h = i32(params.height);
    let x = i32(global_id.x);
    let localY = i32(global_id.y);
    
    // Bounds-check against this tile's height (output buffer is sized
    // per-tile, not per-image) before the per-image height check.
    if (x >= w || localY >= i32(params.tileHeight)) {
      return;
    }
    let globalY = localY + i32(params.rowOffset);
    if (globalY >= h) {
      return;
    }
    
    let halfKernel = i32(params.kernelSize) / 2;
    var sum: f32 = 0.0;
    var weightSum: f32 = 0.0;
    
    // Sample in positive flow direction
    var px: f32 = f32(x);
    var py: f32 = f32(globalY);
    for (var i: i32 = halfKernel; i < i32(params.kernelSize); i++) {
      sum += sampleBilinear(px, py, w, h) * kernel[i];
      weightSum += kernel[i];
      
      let tangent = getTangent(px, py, w, h);
      px += tangent.x;
      py += tangent.y;
    }
    
    // Sample in negative flow direction
    px = f32(x);
    py = f32(globalY);
    for (var i: i32 = halfKernel - 1; i >= 0; i--) {
      let tangent = getTangent(px, py, w, h);
      px -= tangent.x;
      py -= tangent.y;
      
      sum += sampleBilinear(px, py, w, h) * kernel[i];
      weightSum += kernel[i];
    }
    
    if (weightSum > 0.0) {
      output[u32(localY) * params.width + u32(x)] = sum / weightSum;
    } else {
      output[u32(localY) * params.width + u32(x)] = 0.0;
    }
  }
`;

const DEFAULT_FLOW_CONFIG = {
    kernelSizeMultiplier: 6,
    stepSize: 1.0,
};
class CPUFlowGuidedBlur extends BaseCPUStrategy {
    flowField;
    config;
    constructor(flowField, config = {}) {
        super();
        this.flowField = flowField;
        this.config = { ...DEFAULT_FLOW_CONFIG, ...config };
    }
    /** CPU is always available */
    static async isSupported() {
        return true;
    }
    dispose() { }
    /**
     * Update the flow field (e.g., when processing a new image)
     */
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
        const output = createChannelImage$1(input.width, input.height);
        // Number of samples along the flow line
        // Paper samples at 2× sigma in each direction
        const halfSamples = Math.ceil(sigma * 2 / this.config.stepSize);
        const numSamples = halfSamples * 2 + 1;
        // Generate 1D Gaussian weights
        const weights = generateGaussianKernel$1(sigma, numSamples);
        for (let y = 0; y < input.height; y++) {
            for (let x = 0; x < input.width; x++) {
                const value = this.sampleAlongFlow(input, x, y, halfSamples, weights);
                output.data[y * input.width + x] = value;
            }
        }
        return output;
    }
    /**
     * Sample along the flow direction using line integral convolution
     *
     * This follows the tangent field in both directions from the starting point,
     * accumulating weighted samples to produce a blur along the edge direction.
     */
    sampleAlongFlow(input, startX, startY, halfSamples, weights) {
        const stepSize = this.config.stepSize;
        let sum = 0;
        let weightSum = 0;
        // Sample at center (index = halfSamples)
        sum += getPixelBilinear(input, startX, startY) * weights[halfSamples];
        weightSum += weights[halfSamples];
        // Sample in positive flow direction
        let px = startX;
        let py = startY;
        for (let i = 1; i <= halfSamples; i++) {
            // Step along flow
            const tangent = this.flowField.getTangent(Math.round(px), Math.round(py));
            px += tangent.x * stepSize;
            py += tangent.y * stepSize;
            // Bounds check (with tolerance for interpolation)
            if (px < -0.5 || px > input.width - 0.5 ||
                py < -0.5 || py > input.height - 0.5) {
                break;
            }
            const idx = halfSamples + i;
            const value = getPixelBilinear(input, px, py);
            sum += value * weights[idx];
            weightSum += weights[idx];
        }
        // Sample in negative flow direction
        px = startX;
        py = startY;
        for (let i = 1; i <= halfSamples; i++) {
            // Step against flow
            const tangent = this.flowField.getTangent(Math.round(px), Math.round(py));
            px -= tangent.x * stepSize;
            py -= tangent.y * stepSize;
            // Bounds check
            if (px < -0.5 || px > input.width - 0.5 ||
                py < -0.5 || py > input.height - 0.5) {
                break;
            }
            const idx = halfSamples - i;
            const value = getPixelBilinear(input, px, py);
            sum += value * weights[idx];
            weightSum += weights[idx];
        }
        return weightSum > 0 ? sum / weightSum : 0;
    }
}
const DEFAULT_WEBGL_CONFIG = {
    kernelSizeMultiplier: 6,
    maxKernelSize: 63,
};
function compileShader$1(gl, source, type) {
    const shader = gl.createShader(type);
    if (!shader) {
        throw new Error('Failed to create shader');
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Shader compilation failed: ${info}`);
    }
    return shader;
}
/**
 * Create a WebGL2 program from vertex and fragment shaders
 */
function createProgram$1(gl, vertexSource, fragmentSource) {
    const vertexShader = compileShader$1(gl, vertexSource, gl.VERTEX_SHADER);
    const fragmentShader = compileShader$1(gl, fragmentSource, gl.FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) {
        throw new Error('Failed to create program');
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`Program linking failed: ${info}`);
    }
    // Clean up shaders (they're now part of the program)
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return program;
}
/**
 * WebGL2-accelerated flow-guided blur
 * Uses line integral convolution along edge tangent directions
 */
class WebGLFlowGuidedBlur extends BaseWebGLStrategy {
    config;
    flowField;
    resources = null;
    currentWidth = 0;
    currentHeight = 0;
    framebuffer = null;
    textures = [];
    flowTexture = null;
    constructor(flowField, config = {}) {
        super();
        this.flowField = flowField;
        this.config = { ...DEFAULT_WEBGL_CONFIG, ...config };
    }
    /**
     * Same check as WebGLIsotropicBlur: a real, hardware-accelerated WebGL2
     * context with float render targets, excluding software rasterizers.
     */
    static async isSupported() {
        return isWebGLComputeSupported();
    }
    initResources() {
        if (this.resources)
            return this.resources;
        let canvas;
        if (typeof OffscreenCanvas !== 'undefined') {
            canvas = new OffscreenCanvas(1, 1);
        }
        else {
            canvas = document.createElement('canvas');
        }
        const gl = canvas.getContext('webgl2');
        if (!gl)
            throw new Error('WebGL2 is not supported');
        const program = createProgram$1(gl, source$g, source$h);
        const quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1, 1, 1,
        ]), gl.STATIC_DRAW);
        const texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            0, 0, 1, 0, 0, 1, 1, 1,
        ]), gl.STATIC_DRAW);
        this.resources = { gl, canvas, program, quadBuffer, texCoordBuffer };
        return this.resources;
    }
    ensureTextureSize(gl, width, height) {
        if (this.currentWidth === width && this.currentHeight === height) {
            return;
        }
        for (const tex of this.textures) {
            gl.deleteTexture(tex);
        }
        if (this.flowTexture) {
            gl.deleteTexture(this.flowTexture);
        }
        if (this.framebuffer) {
            gl.deleteFramebuffer(this.framebuffer);
        }
        this.textures = [];
        for (let i = 0; i < 2; i++) {
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            this.textures.push(texture);
        }
        this.flowTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.flowTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const flowData = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                const tangent = this.flowField.getTangent(x, y);
                flowData[idx] = Math.round((tangent.x + 1) * 0.5 * 255);
                flowData[idx + 1] = Math.round((tangent.y + 1) * 0.5 * 255);
                flowData[idx + 2] = 0;
                flowData[idx + 3] = 255;
            }
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, flowData);
        this.framebuffer = gl.createFramebuffer();
        this.currentWidth = width;
        this.currentHeight = height;
        const { canvas } = this.resources;
        canvas.width = width;
        canvas.height = height;
    }
    /**
     * Update the flow field (e.g., when processing a new image)
     */
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
        const { gl, program, quadBuffer, texCoordBuffer } = this.initResources();
        const { width, height } = input;
        this.ensureTextureSize(gl, width, height);
        const kernelSize = Math.min(this.config.maxKernelSize, Math.max(3, Math.floor(sigma * this.config.kernelSizeMultiplier) | 1));
        const kernel = generateGaussianKernel$1(sigma, kernelSize);
        const paddedKernel = new Float32Array(64);
        paddedKernel.set(kernel);
        const inputRGBA = new Uint8Array(width * height * 4);
        for (let i = 0; i < input.data.length; i++) {
            const value = Math.max(0, Math.min(255, Math.round(input.data[i] * 255)));
            inputRGBA[i * 4] = value;
            inputRGBA[i * 4 + 1] = value;
            inputRGBA[i * 4 + 2] = value;
            inputRGBA[i * 4 + 3] = 255;
        }
        gl.bindTexture(gl.TEXTURE_2D, this.textures[0]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, inputRGBA);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[1], 0);
        gl.viewport(0, 0, width, height);
        gl.useProgram(program);
        const positionLoc = gl.getAttribLocation(program, 'a_position');
        const texCoordLoc = gl.getAttribLocation(program, 'a_texCoord');
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(positionLoc);
        gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.enableVertexAttribArray(texCoordLoc);
        gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[0]);
        gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.flowTexture);
        gl.uniform1i(gl.getUniformLocation(program, 'u_flowField'), 1);
        gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), width, height);
        gl.uniform1fv(gl.getUniformLocation(program, 'u_kernel'), paddedKernel);
        gl.uniform1i(gl.getUniformLocation(program, 'u_kernelSize'), kernel.length);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        const outputRGBA = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, outputRGBA);
        const output = createChannelImage$1(width, height);
        for (let i = 0; i < output.data.length; i++) {
            output.data[i] = outputRGBA[i * 4] / 255;
        }
        return output;
    }
    dispose() {
        if (!this.resources)
            return;
        const { gl } = this.resources;
        gl.deleteProgram(this.resources.program);
        gl.deleteBuffer(this.resources.quadBuffer);
        gl.deleteBuffer(this.resources.texCoordBuffer);
        for (const tex of this.textures) {
            gl.deleteTexture(tex);
        }
        if (this.flowTexture) {
            gl.deleteTexture(this.flowTexture);
        }
        if (this.framebuffer) {
            gl.deleteFramebuffer(this.framebuffer);
        }
        this.resources = null;
        this.textures = [];
        this.flowTexture = null;
        this.framebuffer = null;
    }
}
const DEFAULT_WEBGPU_CONFIG = {
    kernelSizeMultiplier: 6,
    maxKernelSize: 127,
};
/**
 * WebGPU-accelerated flow-guided blur
 */
class WebGPUFlowGuidedBlur extends BaseWebGPUStrategy {
    config;
    flowField;
    resources = null;
    // proportional to kernel size, never to
    // image size, so there's no reason to ever tile these.
    kernelBuffer = null;
    currentKernelSize = 0;
    // Cached flow-field texture. Rebuilt when setFlowField() marks it dirty
    // or the image dimensions change. Baked in row-chunks (not one
    // Float32Array(width*height*2)) so preparing it for a huge image doesn't
    // itself blow up JS heap before any GPU work happens.
    flowTexture = null;
    flowFieldWidth = 0;
    flowFieldHeight = 0;
    flowDirty = true;
    static CPU_BAKE_ROWS_PER_CHUNK = 512;
    // Bytes we're willing to put in a single GPU buffer for one row-band
    // tile of *output*. Large images are processed in row-band tiles bounded
    // by this, so memory use stays flat regardless of image size
    maxTileBytes = 0;
    static TILE_MEMORY_SAFETY_FACTOR = 0.5;
    constructor(flowField, config = {}) {
        super();
        this.flowField = flowField;
        this.config = { ...DEFAULT_WEBGPU_CONFIG, ...config };
    }
    /**
     * Confirms an adapter is actually obtainable, not just that
     * `navigator.gpu` exists as an API surface.
     */
    static async isSupported() {
        return isWebGPUSupported();
    }
    async initResources() {
        if (this.resources)
            return this.resources;
        const device = await WebGPUFlowGuidedBlur.getWebGPUDevice();
        if (!device) {
            throw new Error('WebGPU device not available');
        }
        // maxBufferSize / maxStorageBufferBindingSize are usually the binding
        // constraint that bites first on large images (commonly 256MB / 128MB
        // by default, even when the adapter can do far more). Cap tile size to
        // half of whichever is smaller as a safety margin. Driver-reported
        // limits are the ceiling, not a size it's safe to actually hit.
        const limits = device.limits;
        this.maxTileBytes = Math.max(16 * 4, // never go below one row's worth of data at workgroup width 16
        Math.floor(Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize) *
            WebGPUFlowGuidedBlur.TILE_MEMORY_SAFETY_FACTOR));
        // Flow blur needs 5 bindings: params, kernel, input tex, flow tex, output.
        // input/flowField moved from storage buffers to textures (see
        // FLOW_BLUR_WGSL comment above) so they're bound by
        // maxTextureDimension2D instead of the much smaller storage-buffer
        // binding limit.
        const flowBindGroupLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        const pipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [flowBindGroupLayout],
        });
        const flowPipeline = device.createComputePipeline({
            layout: pipelineLayout,
            compute: {
                module: device.createShaderModule({ code: source$f }),
                entryPoint: 'main',
            },
        });
        this.resources = {
            device,
            horizontalPipeline: null, // Not used for flow blur
            verticalPipeline: null,
            bindGroupLayout: flowBindGroupLayout,
            flowPipeline,
            flowBindGroupLayout,
        };
        return this.resources;
    }
    /**
     * Textures are bound by maxTextureDimension2D (typically 8192-16384),
     * not the storage-buffer binding limit. That ceiling still exists,
     * and silently exceeding it is exactly the failure mode this fix is
     * closing off. Throw a clear, catchable error instead, so the
     * FlowGuidedBlur wrapper's fallback logic gets a chance to demote to
     * WebGL/CPU rather than the caller getting corrupted output.
     */
    assertWithinTextureLimits(device, width, height) {
        const maxDim = device.limits.maxTextureDimension2D;
        if (width > maxDim || height > maxDim) {
            throw new Error(`[FlowGuidedBlur/WebGPU] Image ${width}x${height} exceeds this device's ` +
                `maxTextureDimension2D (${maxDim}) on at least one axis. The input/flow ` +
                `textures are each a single full-image texture, so this can't be worked ` +
                `around by row-band tiling alone (that only bounds the output/readback ` +
                `buffers). Downscale the image, or split it into overlapping regions ` +
                `upstream and blur each region separately.`);
        }
    }
    /**
     * (Re)builds the flow-field texture for the given dimensions if it's
     * missing, stale (setFlowField() was called), or the wrong size. Built
     * in row-chunks rather than one Float32Array(width*height*2) for the
     * whole image, so preparing this for a large image doesn't itself blow
     * up JS heap before any GPU work happens.
     */
    bakeFlowTexture(device, width, height) {
        this.assertWithinTextureLimits(device, width, height);
        const newTexture = device.createTexture({
            size: [width, height],
            format: 'rg32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        const rowsPerChunk = Math.max(1, WebGPUFlowGuidedBlur.CPU_BAKE_ROWS_PER_CHUNK);
        for (let y0 = 0; y0 < height; y0 += rowsPerChunk) {
            const rows = Math.min(rowsPerChunk, height - y0);
            const chunk = new Float32Array(width * rows * 2);
            for (let ry = 0; ry < rows; ry++) {
                const y = y0 + ry;
                for (let x = 0; x < width; x++) {
                    const tangent = this.flowField.getTangent(x, y);
                    const idx = (ry * width + x) * 2;
                    chunk[idx] = tangent.x;
                    chunk[idx + 1] = tangent.y;
                }
            }
            device.queue.writeTexture({ texture: newTexture, origin: { x: 0, y: y0 } }, chunk, { bytesPerRow: width * 2 * 4, rowsPerImage: rows }, { width, height: rows });
        }
        const oldTexture = this.flowTexture;
        this.flowTexture = newTexture;
        oldTexture?.destroy();
        this.flowFieldWidth = width;
        this.flowFieldHeight = height;
        this.flowDirty = false;
        return newTexture;
    }
    getFlowTexture(device, width, height) {
        if (this.flowTexture &&
            !this.flowDirty &&
            this.flowFieldWidth === width &&
            this.flowFieldHeight === height) {
            return this.flowTexture;
        }
        return this.bakeFlowTexture(device, width, height);
    }
    /**
     * Update the flow field (e.g., when processing a new image). Marks the
     * cached flow texture dirty rather than rebuilding immediately. The
     * next blur() call rebuilds it against the dimensions that call actually
     * needs.
     */
    setFlowField(flowField) {
        this.flowField = flowField;
        this.flowDirty = true;
    }
    /**
     * MEMORY: the output/readback path is processed in row-band tiles
     * bounded by `maxTileBytes`, not one whole-image buffer
     */
    async blur(input, sigma) {
        if (sigma < 0.1) {
            return {
                data: new Float32Array(input.data),
                width: input.width,
                height: input.height,
            };
        }
        const { device, flowPipeline, flowBindGroupLayout } = await this.initResources();
        const { width, height } = input;
        this.assertWithinTextureLimits(device, width, height);
        const flowTexture = this.getFlowTexture(device, width, height);
        const kernelSize = Math.min(this.config.maxKernelSize, Math.max(3, Math.floor(sigma * this.config.kernelSizeMultiplier) | 1));
        const kernel = generateGaussianKernel$1(sigma, kernelSize);
        if (this.currentKernelSize < kernelSize) {
            this.kernelBuffer?.destroy();
            this.kernelBuffer = device.createBuffer({
                size: kernelSize * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            this.currentKernelSize = kernelSize;
        }
        device.queue.writeBuffer(this.kernelBuffer, 0, new Float32Array(kernel));
        const inputTexture = device.createTexture({
            size: [width, height],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        const paramsBuffer = device.createBuffer({
            size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        // Row-band tile plan. Only the output/readback buffers scale with
        // tile size. input/flow textures above are still whole-image.
        const bytesPerRow = width * 4;
        const rowsPerTile = Math.max(1, Math.min(height, Math.floor(this.maxTileBytes / bytesPerRow)));
        const tileBufferSize = rowsPerTile * bytesPerRow;
        const outputBuffer = device.createBuffer({
            size: tileBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        const readBuffer = device.createBuffer({
            size: tileBufferSize,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        try {
            device.queue.writeTexture({ texture: inputTexture }, input.data, { bytesPerRow, rowsPerImage: height }, { width, height });
            const bindGroup = device.createBindGroup({
                layout: flowBindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: paramsBuffer } },
                    { binding: 1, resource: { buffer: this.kernelBuffer } },
                    { binding: 2, resource: inputTexture.createView() },
                    { binding: 3, resource: flowTexture.createView() },
                    { binding: 4, resource: { buffer: outputBuffer } },
                ],
            });
            const output = createChannelImage$1(width, height);
            // Tiles are processed sequentially (dispatch -> readback -> next),
            // since outputBuffer/readBuffer are reused across iterations.
            // reuse keeps memory bounded, at the cost of some
            // overlap opportunity between tiles.
            for (let rowOffset = 0; rowOffset < height; rowOffset += rowsPerTile) {
                const tileHeight = Math.min(rowsPerTile, height - rowOffset);
                device.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([width, height, kernelSize, rowOffset, tileHeight, 0, 0, 0]));
                const commandEncoder = device.createCommandEncoder();
                const computePass = commandEncoder.beginComputePass();
                computePass.setPipeline(flowPipeline);
                computePass.setBindGroup(0, bindGroup);
                computePass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(tileHeight / 16));
                computePass.end();
                commandEncoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, tileHeight * bytesPerRow);
                device.queue.submit([commandEncoder.finish()]);
                await readBuffer.mapAsync(GPUMapMode.READ, 0, tileHeight * bytesPerRow);
                const mapped = readBuffer.getMappedRange(0, tileHeight * bytesPerRow);
                output.data.set(new Float32Array(mapped), rowOffset * width);
                readBuffer.unmap();
            }
            return output;
        }
        finally {
            // Always release per-call resources, even if a pass or readback
            // throws, so concurrent/repeated calls don't leak GPU memory.
            inputTexture.destroy();
            outputBuffer.destroy();
            readBuffer.destroy();
            paramsBuffer.destroy();
        }
    }
    dispose() {
        this.kernelBuffer?.destroy();
        this.flowTexture?.destroy();
        this.kernelBuffer = null;
        this.currentKernelSize = 0;
        this.flowTexture = null;
        this.flowFieldWidth = 0;
        this.flowFieldHeight = 0;
        this.flowDirty = true;
        this.resources = null;
    }
}
/**
 * Backend-agnostic flow-guided blur. Same per-algorithm backend selection
 * and single-retry fallback as `IsotropicBlur`
 *
 * One addition here: the flow field is mutable,
 * so it has to be tracked on the wrapper too. A
 * fallback needs to construct the next backend with the *current* flow
 * field, not the one from construction time.
 */
class FlowGuidedBlur {
    instance;
    currentCtor;
    config;
    flowField;
    failedBackends = new Set();
    constructor(instance, currentCtor, config, flowField) {
        this.instance = instance;
        this.currentCtor = currentCtor;
        this.config = config;
        this.flowField = flowField;
    }
    // Ordered best-to-worst. `satisfies` (not `implements`) catches a
    // backend missing isSupported() or the instance shape at this line.
    static candidates = [
        WebGPUFlowGuidedBlur,
        WebGLFlowGuidedBlur,
        CPUFlowGuidedBlur,
    ];
    static async create(flowField, config = {}) {
        for (const Ctor of FlowGuidedBlur.candidates) {
            if (await Ctor.isSupported()) {
                try {
                    return new FlowGuidedBlur(new Ctor(flowField, config), Ctor, config, flowField);
                }
                catch {
                    continue; // isSupported() lied
                }
            }
        }
        throw new Error('No supported flow-guided blur implementation available');
    }
    get backend() {
        return this.instance.backend;
    }
    dispose() {
        this.instance.dispose();
    }
    async blur(input, sigma) {
        let current = this.instance;
        while (true) {
            try {
                console.log(`${this.constructor.name}: Running ${current.backend}`);
                return await current.blur(input, sigma);
            }
            catch (err) {
                console.warn(`${this.constructor.name}: [${this.currentCtor.name}] process() failed, attempting fallback:`, err);
                const fallback = await this.demoteAndFindNext();
                if (!fallback)
                    throw err;
                current = fallback;
            }
        }
    }
    /**
     * Update the flow field (e.g., when processing a new frame). Stored on
     * the wrapper too, so a later backend fallback hands the new instance
     * the current flow field rather than a stale one from construction time.
     */
    setFlowField(flowField) {
        this.flowField = flowField;
        this.instance.setFlowField(flowField);
    }
    async demoteAndFindNext() {
        this.failedBackends.add(this.currentCtor);
        this.instance.dispose();
        for (const Ctor of FlowGuidedBlur.candidates) {
            if (this.failedBackends.has(Ctor))
                continue;
            if (await Ctor.isSupported()) {
                try {
                    this.instance = new Ctor(this.flowField, this.config);
                    this.currentCtor = Ctor;
                    console.warn(`Falling back to ${Ctor.name}`);
                    return this.instance;
                }
                catch (err) {
                    console.warn(`[${Ctor.name}] construction failed despite isSupported():`, err);
                    this.failedBackends.add(Ctor);
                }
            }
        }
        return null;
    }
}

/**
 * High-level FDoG implementation
 *
 * This class provides a convenient wrapper that compose the blur strategies
 * and DoG processor together.
 *
 * Based on: "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 */
/**
 * FDoG (Flow-based Difference of Gaussians)
 *
 * Uses flow-guided blur along edge tangent directions for coherent line drawing.
 * Produces smoother, more artistic results similar to hand-drawn illustrations.
 *
 * This implements the full FDoG pipeline from Section 2.6:
 * 1. Compute Edge Tangent Flow (ETF) from structure tensor
 * 2. Apply gradient-aligned DoG (across edges)
 * 3. Apply flow-aligned smoothing (along edges)
 * 4. Apply soft thresholding
 * 5. Optional: Apply anti-aliasing LIC pass
 *
 * Parameters:
 * - sigmaC: Structure tensor smoothing (controls ETF smoothness)
 * - sigmaE: Edge detection sigma (controls edge width)
 * - sigmaM: Flow-aligned smoothing (controls line coherence)
 * - sigmaA: Anti-aliasing sigma (optional post-processing)
 */
class FDoG {
    config;
    constructor(config = {}) {
        this.config = {
            ...DEFAULT_FDOG_CONFIG,
            ...config,
        };
    }
    dispose() {
    }
    /**
     * Create FDoG with a preset style
     */
    static withPreset(presetName) {
        return new FDoG(FDOG_STYLE_PRESETS[presetName]);
    }
    /**
     * Process a grayscale image
     *
     * Unlike XDoG, FDoG computes a new flow field for each image,
     * so the full pipeline runs fresh each time.
     */
    async process(input, overrides = {}) {
        const params = { ...this.config, ...overrides };
        const etfComputer = await EdgeTangentFlowComputer.create();
        const flowField = await etfComputer.compute(input, {
            iterations: params.etfIterations ?? DEFAULT_ETF_CONFIG.iterations,
            kernelSize: Math.ceil(params.sigmaC * 2.45) * 2 + 1,
        }, params.sigmaC);
        const weighting = resolveConfidenceWeighting(params.confidenceWeighting);
        const needsWeightingFields = weighting.pByMagnitude || weighting.sigmaMBlend || weighting.sigmaABlend || weighting.epsilonMargin > 0;
        const magnitude = needsWeightingFields ? normalizedMagnitudeField(flowField) : undefined;
        const confidence = needsWeightingFields ? ScalarField.scale(anisotropyField(flowField), magnitude) : undefined;
        const gradientBlur = await GradientAlignedBlur.create(flowField);
        console.log(params);
        // Only derive an adaptive p map if the developer opted in AND didn't
        // already hand us their own ChannelImage.
        const p = weighting.pByMagnitude && typeof params.p === 'number' && confidence
            ? ScalarField.materialize(ScalarField.scale(ScalarField.constant(params.p), confidence), input.width, input.height)
            : params.p;
        const processor = new DoGProcessor(gradientBlur, { ...params, p });
        let sharpened = await processor.processNoThreshold(input);
        const flowBlur = await FlowGuidedBlur.create(flowField);
        if (params.sigmaM > 0) {
            const flowSmoothed = await flowBlur.blur(sharpened, params.sigmaM);
            sharpened = weighting.sigmaMBlend
                ? blendByConfidence(flowSmoothed, sharpened, confidence)
                : flowSmoothed;
        }
        const epsilon = weighting.epsilonMargin > 0 && typeof params.epsilon === 'number'
            ? ScalarField.materialize(ScalarField.map(confidence, c => params.epsilon + (1 - c) * weighting.epsilonMargin), input.width, input.height)
            : params.epsilon;
        let result = processor.applyThreshold(sharpened, epsilon, params.phi);
        processor.dispose();
        if (params.sigmaA > 0) {
            const aa = await flowBlur.blur(result, params.sigmaA);
            result = weighting.sigmaABlend
                ? blendByConfidence(aa, result, confidence)
                : aa;
        }
        flowBlur.dispose();
        etfComputer.dispose();
        return result;
    }
    /**
     * Process with more control over individual stages
     */
    async processDetailed(input, overrides = {}) {
        const params = { ...this.config, ...overrides };
        // Compute ETF
        const etfComputer = await EdgeTangentFlowComputer.create();
        const etf = await etfComputer.compute(input, {
            iterations: DEFAULT_ETF_CONFIG.iterations,
            kernelSize: Math.ceil(params.sigmaC * 2.45) * 2 + 1,
        }, params.sigmaC);
        // Create blur strategies
        const gradientBlur = await GradientAlignedBlur.create(etf);
        const processor = new DoGProcessor(gradientBlur, params);
        // Continuous (pre-threshold, pre-accumulation) DoG response.
        const rawSharpened = await processor.processNoThreshold(input);
        const flowBlur = await FlowGuidedBlur.create(etf);
        // Sec. 2.6: sigma_m flow-aligned accumulation is part of the FDoG
        // operator itself and must happen on the continuous response, before
        // thresholding.
        const sharpened = params.sigmaM > 0
            ? await flowBlur.blur(rawSharpened, params.sigmaM)
            : rawSharpened;
        // Threshold once -- this is the paper's "two tone result" (Fig. 6/7b),
        // computed from the sigma_m-accumulated continuous signal.
        const thresholded = processor.applyThreshold(sharpened, params.epsilon, params.phi);
        processor.dispose();
        // Sec. 4.3: sigma_a anti-aliasing is a separate POST-threshold pass --
        // a small LIC along the ETF applied to the binary/two-tone image to
        // soften its step-function edges. Not another round of pre-threshold
        // smoothing.
        const smoothed = params.sigmaA > 0
            ? await flowBlur.blur(thresholded, params.sigmaA)
            : thresholded;
        flowBlur.dispose();
        etfComputer.dispose();
        const result = smoothed;
        return { result, etf, sharpened, thresholded, smoothed };
    }
    /**
     * Convenience method to process ImageData directly
     */
    async processGrayscaleImageData(input, overrides = {}) {
        const grayscale = imageDataToLuminance(input);
        const result = await this.process(grayscale, overrides);
        return luminanceToImageData(result);
    }
    /**
     * Process with a pre-computed ETF
     *
     * Useful when processing multiple frames of video where the ETF
     * can be computed once and reused, or interpolated between keyframes.
     */
    async processWithETF(input, etf, overrides = {}) {
        const params = { ...this.config, ...overrides };
        const gradientBlur = await GradientAlignedBlur.create(etf);
        const processor = new DoGProcessor(gradientBlur, params);
        // Continuous response -- do not threshold yet.
        let sharpened = await processor.processNoThreshold(input);
        // Sec. 2.6: pre-threshold flow accumulation.
        if (params.sigmaM > 0) {
            const flowBlur = await FlowGuidedBlur.create(etf);
            sharpened = await flowBlur.blur(sharpened, params.sigmaM);
            flowBlur.dispose();
        }
        let result = processor.applyThreshold(sharpened, params.epsilon, params.phi);
        processor.dispose();
        // Sec. 4.3: post-threshold anti-aliasing pass.
        if (params.sigmaA > 0) {
            const aaBlur = await FlowGuidedBlur.create(etf);
            result = await aaBlur.blur(result, params.sigmaA);
            aaBlur.dispose();
        }
        return result;
    }
    /**
     * Apply only the anti-aliasing pass to an already-processed image
     */
    async applyAntiAliasing(input, etf, sigmaA) {
        const sigma = sigmaA ?? this.config.sigmaA;
        if (sigma <= 0) {
            return { data: new Float32Array(input.data), width: input.width, height: input.height };
        }
        const aaBlur = await FlowGuidedBlur.create(etf);
        const result = aaBlur.blur(input, sigma);
        aaBlur.dispose();
        return result;
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Update configuration
     */
    setConfig(config) {
        this.config = { ...this.config, ...config };
    }
}
/**
 * Blend two already-materialized images by a confidence field.
 * weight=1 trusts `a`, weight=0 trusts `b`.
 *
 * Unlike the p/epsilon adaptive maps (which stay lazy ScalarFields all
 * the way to processor.ts), `a`/`b` here are real per-call blur outputs;
 * there's no config-shaped ScalarField to hand off to, so this blends
 * and materializes eagerly via ScalarField.blend()/materialize() rather
 * than exposing another bespoke pixel loop.
 */
function blendByConfidence(a, b, confidence) {
    return ScalarField.materialize(ScalarField.blend(ScalarField.fromChannelImage(a), ScalarField.fromChannelImage(b), confidence), a.width, a.height);
}
/**
 * Convenience function for one-shot FDoG processing
 */
async function fdog(input, config = {}) {
    const processor = new FDoG(config);
    const result = processor.process(input);
    processor.dispose();
    return result;
}

/**
 * High-level ADog implementations
 *
 * These classes provide convenient wrappers that compose the blur strategies
 * and DoG processor together.
 */
class ADoG {
    config;
    blurStrategy;
    constructor(config = {}) {
        this.config = { ...DEFAULT_ADOG_CONFIG, kernelSizeMultiplier: 6, ...config };
        this.blurStrategy = IsotropicBlur.create({
            kernelSizeMultiplier: this.config.kernelSizeMultiplier,
        });
    }
    dispose() {
        this.blurStrategy.then(strategy => strategy.dispose());
    }
    /**
     * Analytical epsilon ceiling for a given tau: beyond this, no flat
     * region (however bright) can cross threshold, and the output floods
     * to solid black regardless of image content. Pure function of tau,
     * so it's sync and doesn't need an input image or a processor instance.
     */
    static getEpsilonCeiling(tau) {
        return 1 - tau;
    }
    /**
     * Runs the pipeline once and returns mean/std of the pre-threshold
     * sharpened response, plus the tau-derived ceiling. Shared by
     * estimateEpsilon() and getEpsilonRange() so they don't each pay for
     * their own processDetailed() pass.
     */
    static async computeEpsilonStats(input, config = {}) {
        const processor = new ADoG(config);
        try {
            const { sharpened } = await processor.processDetailed(input);
            const n = sharpened.data.length;
            let sum = 0;
            for (let i = 0; i < n; i++)
                sum += sharpened.data[i];
            const mean = sum / n;
            let sqDiff = 0;
            for (let i = 0; i < n; i++)
                sqDiff += (sharpened.data[i] - mean) ** 2;
            const std = Math.sqrt(sqDiff / n);
            const tau = config.tau ?? DEFAULT_ADOG_CONFIG.tau;
            return { mean, std, ceiling: ADoG.getEpsilonCeiling(tau) };
        }
        finally {
            processor.dispose();
        }
    }
    /**
     * Recommended [min, max] band for the epsilon slider, plus a sensible
     * default, derived from the actual image + config rather than the
     * static ADOG_PARAM_RANGES.epsilon entry (which can't account for
     * tau/s/noiseScaleC/image content).
     */
    static async getEpsilonRange(input, config = {}, spread = 1.5) {
        const { mean, std, ceiling } = await ADoG.computeEpsilonStats(input, config);
        return {
            hardMin: 0,
            recommendedMin: Math.max(0, mean - spread * std),
            recommendedMax: Math.min(ceiling, mean + spread * std),
            hardMax: 0.2,
            default: mean,
            step: 0.001
        };
    }
    /** Existing method, now built on computeEpsilonStats. */
    static async estimateEpsilon(input, config = {}, biasOffset = 0) {
        const { mean } = await ADoG.computeEpsilonStats(input, config);
        return mean - biasOffset;
    }
    /**
     * Analytical epsilon ceiling for a given tau: beyond this, no flat
     * region (however bright) can cross threshold, and the output floods
     * to solid black regardless of image content. Pure function of tau,
     * so it's sync and doesn't need an input image or a processor instance.
     */
    static getEpsilonMax(tau) {
        return 1 - tau;
    }
    static estimateSigma(input, { referenceDimension = 700, baseSigma = 1.0 } = {}) {
        const scale = Math.min(input.width, input.height) / referenceDimension;
        return baseSigma * Math.max(1, scale);
    }
    /**
     * Process a grayscale image through the ADoG pipeline.
     */
    async process(input, overrides = {}) {
        const { result } = await this.processDetailed(input, overrides);
        return result;
    }
    async processDetailed(input, overrides = {}) {
        const params = { ...this.config, ...overrides };
        // Step 1: tone-adaptive noise injection, applied before blurring.
        // Skipped entirely when noiseScaleC is 0 (noise injection is optional,
        // see Figs. 7 vs 8 in the paper).
        const noisyInput = params.noiseScaleC > 0
            ? this.injectAdaptiveNoise(input, params.noiseScaleC, params.s)
            : input;
        // Step 2: two isotropic Gaussian blurs -- sigma = sigmaC, k*sigmaC = sigmaS
        const blurStrategy = await this.blurStrategy;
        const [blurC, blurS] = await Promise.all([
            blurStrategy.blur(noisyInput, params.sigma),
            blurStrategy.blur(noisyInput, params.sigma * params.k),
        ]);
        // Step 3 (Eq. 5): per-pixel adaptive weight rho(x), computed from the
        // ORIGINAL (pre-noise) input tone -- not from the blurred images.
        const rhoMap = this.computeRhoMap(input, params.tau, params.s);
        // Step 4 (Eq. 4): ADoG(x) = G_sigmaC(x) - rho(x) * G_sigmaS(x)
        const sharpened = this.computeWeightedDoG(blurC, blurS, rhoMap);
        // Unweighted response (rho == 1 everywhere), i.e. standard DoG --
        // exposed for comparison purposes (Fig. 7(b) in the paper).
        const rawDoG = this.computeUnweightedDoG(blurC, blurS);
        // Step 5: binarize (hard threshold by default via config.thresholdStrategy)
        const result = this.config.thresholdStrategy.threshold(sharpened, {
            epsilon: params.epsilon,
            phi: params.phi,
        });
        return { result, sharpened, rawDoG, rhoMap, noisyInput };
    }
    /**
     * Convenience method to process ImageData directly (e.g., from a canvas),
     * matching XDoG/FDoG's convenience method of the same name.
     */
    async processGrayscaleImageData(input, overrides = {}) {
        const grayscale = imageDataToLuminance(input);
        const result = await this.process(grayscale, overrides);
        return luminanceToImageData(result);
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Update configuration
     */
    async setConfig(config) {
        if (config.kernelSizeMultiplier !== undefined) {
            this.blurStrategy = IsotropicBlur.create({ kernelSizeMultiplier: config.kernelSizeMultiplier });
        }
        this.config = { ...this.config, ...config };
    }
    /** Eq. (5): rho(x) = tau + (1 - tau) * (1 - tanh(s * I(x))) */
    computeRhoMap(input, tau, s) {
        const output = createChannelImage$1(input.width, input.height);
        for (let i = 0; i < input.data.length; i++) {
            output.data[i] = tau + (1 - tau) * (1 - Math.tanh(s * input.data[i]));
        }
        return output;
    }
    /** Eq. (6): sigma(x) = c * (1 - tanh(s * I(x))); sampled noise ~ N(0,1) * sigma(x) added to I(x) */
    injectAdaptiveNoise(input, c, s) {
        const output = createChannelImage$1(input.width, input.height);
        for (let i = 0; i < input.data.length; i++) {
            const sigma = c * (1 - Math.tanh(s * input.data[i]));
            output.data[i] = input.data[i] + sigma * gaussianSample();
        }
        return output;
    }
    /** Eq. (3)/(4): ADoG(x) = G_sigmaC(x) - rho(x) * G_sigmaS(x) */
    computeWeightedDoG(blurC, blurS, rho) {
        const output = createChannelImage$1(blurC.width, blurC.height);
        for (let i = 0; i < blurC.data.length; i++) {
            output.data[i] = blurC.data[i] - rho.data[i] * blurS.data[i];
        }
        return output;
    }
    /** Standard (non-adaptive) DoG: G_sigmaC(x) - G_sigmaS(x), i.e. rho == 1 everywhere */
    computeUnweightedDoG(blurC, blurS) {
        const output = createChannelImage$1(blurC.width, blurC.height);
        for (let i = 0; i < blurC.data.length; i++) {
            output.data[i] = blurC.data[i] - blurS.data[i];
        }
        return output;
    }
}
/**
 * Sample a single value from a standard normal distribution N(0, 1)
 * using the Box-Muller transform.
 *
 * Used by ADoG's adaptive noise injection (Eq. 6): the sampled value is
 * scaled by a tone-dependent sigma(x) and added to the input luminance.
 */
function gaussianSample() {
    // Avoid Math.log(0) by excluding 0 from the uniform sample
    let u1 = 0;
    while (u1 === 0) {
        u1 = Math.random();
    }
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}
/**
 * Convenience function for one-shot ADoG processing, matching xdog()/fdog()
 * in dog.ts
 */
async function adog(input, config = {}) {
    const processor = new ADoG(config);
    const result = await processor.process(input);
    processor.dispose();
    return result;
}

/**
 * High-level HDoG implementations
 *
 * This class provides a convenient wrapper that compose the blur strategies
 * and DoG processor together.
 */
class HDoG {
    fdog;
    adogPrimary;
    adogSecondary;
    constructor(config = {}) {
        const merged = { ...DEFAULT_HDOG_CONFIG, ...config };
        const primaryADoGConfig = { ...DEFAULT_ADOG_CONFIG, ...merged.adog };
        const secondaryADoGConfig = {
            ...DEFAULT_ADOG_CONFIG,
            ...primaryADoGConfig,
            s: primaryADoGConfig.s * merged.adogSecondaryScaleFactor,
            ...merged.adogSecondary,
        };
        this.fdog = new FDoG(merged.fdog);
        this.adogPrimary = new ADoG(primaryADoGConfig);
        this.adogSecondary = new ADoG(secondaryADoGConfig);
    }
    dispose() {
        this.fdog.dispose();
        this.adogPrimary.dispose();
        this.adogSecondary.dispose();
    }
    /**
     * Eq. (9): HDoG = FDoG ∧ ADoG_s ∧ ADoG_s'
     *
     * Note: HDoG's own configuration (fdog/adog/adogSecondaryScaleFactor) is
     * nested rather than a flat DoGConfig, so per-call overrides aren't
     * exposed here the way XDoG/FDoG/ADoG expose them -- there's no clean way
     * to map a flat Partial<DoGConfig> onto "override the nested fdog config,
     * or the nested adog config, or the scale factor". Configure via the
     * constructor; if you need per-call tuning, consider adding a dedicated
     * method (e.g. processWithConfig(input, HDoGConfig overrides)) rather than
     * overloading `process`.
     */
    async process(input) {
        const [lines, tone1, tone2] = await Promise.all([
            this.fdog.process(input),
            this.adogPrimary.process(input),
            this.adogSecondary.process(input),
        ]);
        return andCombine([lines, tone1, tone2]);
    }
    async processDetailed(input) {
        const [fdogDetailed, adog1Detailed, adog2Detailed] = await Promise.all([
            this.fdog.processDetailed(input),
            this.adogPrimary.processDetailed(input),
            this.adogSecondary.processDetailed(input),
        ]);
        const result = andCombine([
            fdogDetailed.result,
            adog1Detailed.result,
            adog2Detailed.result,
        ]);
        return {
            result,
            sharpened: fdogDetailed.sharpened,
            fdogResult: fdogDetailed.result,
            adogPrimaryResult: adog1Detailed.result,
            adogSecondaryResult: adog2Detailed.result,
        };
    }
}
/**
 * Pixel-wise logical AND across N binarized (0/1) ChannelImages.
 *
 * Generalizes Eq. (7)/(9) from "Gaussian Image Binarization":
 *   HDoG = FDoG ∧ ADoG_s ∧ ADoG_s'
 *
 * Since binarized images only contain 0 or 1, logical AND is equivalent to
 * taking the minimum across images (no De Morgan's / inversion needed here
 * -- see the paper's Eq. (8) for why AND and "invert-OR-invert" coincide;
 * this just implements AND directly).
 *
 * All images must have matching dimensions; this is not checked here for
 * performance -- validate upstream if inputs could mismatch.
 */
function andCombine(images) {
    if (images.length === 0) {
        throw new Error('andCombine requires at least one image');
    }
    const { width, height } = images[0];
    const output = createChannelImage$1(width, height);
    const size = width * height;
    for (let i = 0; i < size; i++) {
        let v = 1;
        for (const img of images) {
            v = Math.min(v, img.data[i]);
        }
        output.data[i] = v;
    }
    return output;
}
/**
 * Convenience function for one-shot HDoG processing, matching xdog()/fdog()
 * in dog.ts and adog() in adog.ts
 */
async function hdog(input, config = {}) {
    const processor = new HDoG(config);
    const result = await processor.process(input);
    processor.dispose();
    return result;
}

var index$5 = /*#__PURE__*/Object.freeze({
    __proto__: null,
    ADOG_PARAM_RANGES: ADOG_PARAM_RANGES,
    ADOG_STYLE_PRESETS: ADOG_STYLE_PRESETS,
    ADoG: ADoG,
    DEFAULT_ADOG_CONFIG: DEFAULT_ADOG_CONFIG,
    DEFAULT_DOG_CONFIG: DEFAULT_DOG_CONFIG,
    DEFAULT_FDOG_CONFIG: DEFAULT_FDOG_CONFIG,
    DEFAULT_HDOG_CONFIG: DEFAULT_HDOG_CONFIG,
    DOG_PARAM_RANGES: DOG_PARAM_RANGES,
    FDOG_CONFIDENCE_WEIGHT_PARAM_RANGES: FDOG_CONFIDENCE_WEIGHT_PARAM_RANGES,
    FDOG_PARAM_RANGES: FDOG_PARAM_RANGES,
    FDOG_STYLE_PRESETS: FDOG_STYLE_PRESETS,
    FDoG: FDoG,
    HDOG_PARAM_RANGES: HDOG_PARAM_RANGES,
    HDOG_STYLE_PRESETS: HDOG_STYLE_PRESETS,
    HDoG: HDoG,
    STYLE_PRESETS: STYLE_PRESETS,
    XDOG_PARAM_RANGES: XDOG_PARAM_RANGES,
    XDoG: XDoG,
    adog: adog,
    fdog: fdog,
    hdog: hdog,
    xdog: xdog
});

class EdgeAwareBlurStrategy {
    filter;
    toConfig;
    constructor(filter, toConfig) {
        this.filter = filter;
        this.toConfig = toConfig;
    }
    blur(input, sigma) {
        return this.filter.apply(input, this.toConfig(sigma));
    }
    get backend() { return this.filter.backend; }
    dispose() { this.filter.dispose(); }
}

var index$4 = /*#__PURE__*/Object.freeze({
    __proto__: null,
    CPUFlowGuidedBlur: CPUFlowGuidedBlur,
    EdgeAwareBlurStrategy: EdgeAwareBlurStrategy,
    FlowGuidedBlur: FlowGuidedBlur,
    GradientAlignedBlur: GradientAlignedBlur,
    IsotropicBlur: IsotropicBlur,
    WebGLFlowGuidedBlur: WebGLFlowGuidedBlur,
    WebGPUFlowGuidedBlur: WebGPUFlowGuidedBlur
});

var index$3 = /*#__PURE__*/Object.freeze({
    __proto__: null,
    BilateralFilter: BilateralFilter$2,
    ContrastEnhancer: ContrastEnhancer$2,
    GaussianBlur: GaussianBlur$2,
    IsotropicBlurFilter: IsotropicBlurFilter,
    KuwaharaFilter: KuwaharaFilter$2,
    MedianFilter: MedianFilter$2,
    PreprocessingPresets: PreprocessingPresets$1,
    Quantizer: Quantizer$2,
    cpu: cpu,
    disposeWebGL: disposeWebGL$1,
    disposeWebGPU: disposeWebGPU$1,
    isWebGLAvailable: isWebGLAvailable$2,
    webgl: webgl$1,
    webgpu: webgpu
});

/**
 * Shared per-pixel parameter estimation techniques, used by epsilon.ts,
 * p.ts, and phi.ts to build spatially-varying ChannelImage maps for any of
 * XDoG/FDoG/ADoG's `p`/`epsilon`/`phi` config fields (all typed
 * `number | ChannelImage` -- see DoGConfig in ../../interfaces/dog.js).
 *
 * Four techniques, each keyed to a different signal:
 *
 *   - toneAdaptiveEstimate: interpolate between a "dark" and "light" value
 *     over blurred local tone. Principled for epsilon (S(x) collapses to
 *     local tone in flat regions, per Eq. 7 -- see epsilon.ts). For p/phi
 *     it's available but only as a stylistic option; neither has an
 *     equation tying it to brightness.
 *
 *   - localBaselineEstimate: track a blurred local baseline of the input
 *     directly (+ optional offset/variance margin). Principled for
 *     epsilon specifically -- it's a direct read of the quantity epsilon
 *     is thresholded against, not just a plausible curve.
 *
 *   - magnitudeAdaptiveEstimate: interpolate over local gradient
 *     magnitude. Principled for p -- p multiplies the edge term D(x) =
 *     blur1(x) - blur2(x), which is ~0 in flat regions regardless of
 *     brightness and grows only where there's real gradient structure.
 *
 *   - varianceAdaptiveEstimate: interpolate over local variance.
 *     Principled for phi -- hard-vs-soft threshold steepness plausibly
 *     tracks "is there already texture/detail here," independent of tone.
 *
 * See each parameter file's own module comment for which technique(s) are
 * actually motivated for that parameter -- this file just holds the
 * mechanics.
 */
async function resolveBlur(provided) {
    if (provided)
        return { blur: provided, owns: false };
    return { blur: await IsotropicBlur.create({ kernelSizeMultiplier: 4 }), owns: true };
}
/** value(x) = low + (high - low) * tanh(s * localTone(x)) */
async function toneAdaptiveEstimate$3(input, options) {
    const { low, high, localitySigma = 8, s = 2 } = options;
    const { blur, owns } = await resolveBlur(options.blurStrategy);
    try {
        const localTone = await blur.blur(input, localitySigma);
        const output = createChannelImage$1(input.width, input.height);
        for (let i = 0; i < output.data.length; i++) {
            output.data[i] = low + (high - low) * Math.tanh(s * localTone.data[i]);
        }
        return output;
    }
    finally {
        if (owns)
            blur.dispose();
    }
}
/** Convenience: derive low/high from a center + spread instead of picking both by hand. */
async function toneAdaptiveEstimateAuto$3(input, options) {
    const { center, spread, higherInLight = true, ...rest } = options;
    const low = higherInLight ? center - spread : center + spread;
    const high = higherInLight ? center + spread : center - spread;
    return toneAdaptiveEstimate$3(input, { ...rest, low, high });
}
/** value(x) = blur(input, sigma)(x) + offset [+ contrastMargin * localStdDev(x)] */
async function localBaselineEstimate$1(input, options) {
    const { sigma, offset = 0, contrastMargin = 0 } = options;
    const { blur, owns } = await resolveBlur(options.blurStrategy);
    try {
        const baseline = await blur.blur(input, sigma);
        const output = createChannelImage$1(input.width, input.height);
        if (contrastMargin > 0) {
            const squared = createChannelImage$1(input.width, input.height);
            for (let i = 0; i < input.data.length; i++)
                squared.data[i] = input.data[i] * input.data[i];
            const meanSquared = await blur.blur(squared, sigma);
            for (let i = 0; i < output.data.length; i++) {
                const variance = Math.max(0, meanSquared.data[i] - baseline.data[i] ** 2);
                output.data[i] = baseline.data[i] + offset + contrastMargin * Math.sqrt(variance);
            }
        }
        else {
            for (let i = 0; i < output.data.length; i++) {
                output.data[i] = baseline.data[i] + offset;
            }
        }
        return output;
    }
    finally {
        if (owns)
            blur.dispose();
    }
}
function normalizeToUnit(field, gamma) {
    let max = 0;
    for (let i = 0; i < field.data.length; i++)
        if (field.data[i] > max)
            max = field.data[i];
    const output = createChannelImage$1(field.width, field.height);
    if (max <= 0)
        return output;
    for (let i = 0; i < output.data.length; i++) {
        const n = field.data[i] / max;
        output.data[i] = gamma === 1 ? n : Math.pow(n, gamma);
    }
    return output;
}
function gradientMagnitude(input) {
    const { width, height, data } = input;
    const output = createChannelImage$1(width, height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const xm = Math.max(x - 1, 0), xp = Math.min(x + 1, width - 1);
            const ym = Math.max(y - 1, 0), yp = Math.min(y + 1, height - 1);
            const ix = (data[y * width + xp] - data[y * width + xm]) / (xp - xm || 1);
            const iy = (data[yp * width + x] - data[ym * width + x]) / (yp - ym || 1);
            output.data[y * width + x] = Math.sqrt(ix * ix + iy * iy);
        }
    }
    return output;
}
/** value(x) = low + (high - low) * normalizedGradientMagnitude(x)^gamma */
async function magnitudeAdaptiveEstimate$1(input, options) {
    const { low, high, smoothingSigma = 1, gamma = 1 } = options;
    let magnitude = gradientMagnitude(input);
    if (smoothingSigma > 0) {
        const { blur, owns } = await resolveBlur(options.blurStrategy);
        try {
            magnitude = await blur.blur(magnitude, smoothingSigma);
        }
        finally {
            if (owns)
                blur.dispose();
        }
    }
    const normalized = normalizeToUnit(magnitude, gamma);
    const output = createChannelImage$1(input.width, input.height);
    for (let i = 0; i < output.data.length; i++) {
        output.data[i] = low + (high - low) * normalized.data[i];
    }
    return output;
}
/** value(x) = low + (high - low) * normalizedLocalVariance(x)^gamma */
async function varianceAdaptiveEstimate$1(input, options) {
    const { low, high, sigma, gamma = 1 } = options;
    const { blur, owns } = await resolveBlur(options.blurStrategy);
    try {
        const baseline = await blur.blur(input, sigma);
        const squared = createChannelImage$1(input.width, input.height);
        for (let i = 0; i < input.data.length; i++)
            squared.data[i] = input.data[i] * input.data[i];
        const meanSquared = await blur.blur(squared, sigma);
        const variance = createChannelImage$1(input.width, input.height);
        for (let i = 0; i < variance.data.length; i++) {
            variance.data[i] = Math.max(0, meanSquared.data[i] - baseline.data[i] ** 2);
        }
        const normalized = normalizeToUnit(variance, gamma);
        const output = createChannelImage$1(input.width, input.height);
        for (let i = 0; i < output.data.length; i++) {
            output.data[i] = low + (high - low) * normalized.data[i];
        }
        return output;
    }
    finally {
        if (owns)
            blur.dispose();
    }
}

/**
 * Epsilon parameter estimation
 *
 * XDoG/FDoG/ADoG threshold their continuous sharpened response against a
 * scalar `epsilon`. A fixed epsilon under-serves one tone extreme or the
 * other on high-dynamic-range input.
 *
 * Why epsilon should track local tone (from processor.ts's Eq. 7):
 * S(x) = (1+p)*blur1(x) - p*blur2(x). In flat regions blur1(x) ≈ blur2(x)
 * ≈ local brightness, so S(x) itself sits near local tone there. A flat
 * epsilon tuned for midtones crushes bright regions to white and dark
 * regions to black. For epsilon to threshold something meaningful
 * everywhere, it has to move with local tone -- lower in dark
 * neighborhoods, higher in light ones.
 *
 * Both `toneAdaptiveEstimate` and `localBaselineEstimate` below are
 * principled for epsilon specifically: tone tracking approximates S(x),
 * and local-baseline tracking reads it more directly. See shared.ts for
 * the mechanics, and p.ts/phi.ts for why a *different* signal (not tone)
 * is the principled choice for those parameters instead.
 */
async function toneAdaptiveEstimate$2(input, options) {
    const { epsilonDark, epsilonLight, ...rest } = options;
    return toneAdaptiveEstimate$3(input, { ...rest, low: epsilonDark, high: epsilonLight });
}
async function toneAdaptiveEstimateAuto$2(input, options) {
    const { denserInDark = true, ...rest } = options;
    return toneAdaptiveEstimateAuto$3(input, { ...rest, higherInLight: denserInDark });
}
/**
 * Recommended default: epsilon as the local baseline of the sharpened
 * response. `sigma` should track the DoG's own sigma (this is what
 * `computeSharpening()` actually produces in flat regions).
 */
async function localBaselineEstimate(input, options) {
    return localBaselineEstimate$1(input, options);
}
/**
 * Spatially-varying epsilon map for ADoG specifically. Unlike the generic
 * epsilon.localBaselineEstimate (principled for XDoG's S(x) ≈ localTone),
 * ADoG's flat-region response is I(x) * (1-p(x)) = I(x) * (1-τ) * tanh(s * I(x)),
 * bounded by (1-τ) rather than 1 (see Eq. 4/5). This pre-scales the input
 * by that closed form before handing it to the same blur/offset/
 * contrastMargin machinery shared.localBaselineEstimate already provides.
 */
async function adogLocalBaselineEstimate(input, options) {
    const { tau, s, ...baseOptions } = options;
    const scaled = createChannelImage$1(input.width, input.height);
    for (let i = 0; i < input.data.length; i++) {
        const I = input.data[i];
        scaled.data[i] = I * (1 - tau) * Math.tanh(s * I);
    }
    return localBaselineEstimate$1(scaled, baseOptions);
}
/**
 * Usage:
 *
 *   import { XDoG } from '../../implementations/xdog.js';
 *   import { ScalarField } from '../../utils/scalar-field.js';
 *   import { localBaselineEstimate } from './epsilon.js';
 *
 *   const epsilonMap = await localBaselineEstimate(input, { sigma: 1.4 });
 *   const result = await new XDoG({ sigma: 1.4, k: 1.6, phi: 10 }).process(input, {
 *     epsilon: ScalarField.fromChannelImage(epsilonMap),
 *   });
 */

var epsilon = /*#__PURE__*/Object.freeze({
    __proto__: null,
    adogLocalBaselineEstimate: adogLocalBaselineEstimate,
    localBaselineEstimate: localBaselineEstimate,
    toneAdaptiveEstimate: toneAdaptiveEstimate$2,
    toneAdaptiveEstimateAuto: toneAdaptiveEstimateAuto$2
});

/**
 * p (sharpening strength) parameter estimation
 *
 * p multiplies the edge term in Eq. 7: S(x) = blur1(x) + p*D(x), where
 * D(x) = blur1(x) - blur2(x). D(x) is ~0 in flat regions regardless of
 * brightness, and grows only where there's real gradient structure. So a
 * spatially-varying p should track *gradient magnitude*, not tone --
 * `magnitudeAdaptiveEstimate` below is the principled default.
 *
 * `toneAdaptiveEstimate`/`toneAdaptiveEstimateAuto` are also exposed, but
 * unlike epsilon.ts's use of the same technique, they're NOT derived from
 * anything -- there's no equation tying p to brightness. Use only if you
 * deliberately want a brightness-driven look and know that's the choice
 * you're making.
 *
 * If using FDoG with an ETF already computed, prefer its
 * `confidenceWeighting.pByMagnitude` (../../interfaces/dog.js) instead --
 * same idea, smoothed/refined magnitude rather than a raw gradient.
 */
/** Recommended default. p(x) = pWeak + (pStrong - pWeak) * normalizedGradientMagnitude(x)^gamma */
async function magnitudeAdaptiveEstimate(input, options) {
    const { pWeak, pStrong, ...rest } = options;
    return magnitudeAdaptiveEstimate$1(input, { ...rest, low: pWeak, high: pStrong });
}
/** Stylistic only -- NOT derived from Eq. 7. See module comment. */
async function toneAdaptiveEstimate$1(input, options) {
    const { pDark, pLight, ...rest } = options;
    return toneAdaptiveEstimate$3(input, { ...rest, low: pDark, high: pLight });
}
/** Stylistic only -- NOT derived from Eq. 7. See module comment. */
async function toneAdaptiveEstimateAuto$1(input, options) {
    return toneAdaptiveEstimateAuto$3(input, options);
}
/**
 * Usage:
 *
 *   import { XDoG } from '../../implementations/xdog.js';
 *   import { ScalarField } from '../../utils/scalar-field.js';
 *   import { magnitudeAdaptiveEstimate } from './p.js';
 *
 *   const pMap = await magnitudeAdaptiveEstimate(input, { pWeak: 5, pStrong: 40 });
 *   const result = await new XDoG({ sigma: 1.4, k: 1.6, epsilon: 0.78 }).process(input, {
 *     p: ScalarField.fromChannelImage(pMap),
 *   });
 */

var p = /*#__PURE__*/Object.freeze({
    __proto__: null,
    magnitudeAdaptiveEstimate: magnitudeAdaptiveEstimate,
    toneAdaptiveEstimate: toneAdaptiveEstimate$1,
    toneAdaptiveEstimateAuto: toneAdaptiveEstimateAuto$1
});

/**
 * phi (soft-threshold steepness) parameter estimation
 *
 * phi controls tanh steepness of the soft threshold (low phi = gradual
 * pencil shading, high phi = near step function). No equation ties it to
 * brightness, but local variance is a plausible signal: a neighborhood
 * that already has real detail is a reasonable candidate for hard edges;
 * a flat neighborhood, for soft shading -- independent of tone.
 * `varianceAdaptiveEstimate` below is the principled default.
 *
 * `toneAdaptiveEstimate`/`toneAdaptiveEstimateAuto` are exposed as a
 * labeled stylistic option only (same caveat as p.ts) -- not derived from
 * anything.
 *
 * Note: `HardThresholdStrategy` (ADoG/FDoG's default) ignores `phi`
 * entirely -- a spatially-varying phi only matters under
 * `SoftThresholdStrategy`.
 */
/** Recommended default. phi(x) = phiSoft + (phiHard - phiSoft) * normalizedVariance(x)^gamma */
async function varianceAdaptiveEstimate(input, options) {
    const { phiSoft, phiHard, ...rest } = options;
    return varianceAdaptiveEstimate$1(input, { ...rest, low: phiSoft, high: phiHard });
}
/** Stylistic only -- not derived from anything. See module comment. */
async function toneAdaptiveEstimate(input, options) {
    const { phiDark, phiLight, ...rest } = options;
    return toneAdaptiveEstimate$3(input, { ...rest, low: phiDark, high: phiLight });
}
/** Stylistic only -- not derived from anything. See module comment. */
async function toneAdaptiveEstimateAuto(input, options) {
    return toneAdaptiveEstimateAuto$3(input, options);
}
/**
 * Usage:
 *
 *   import { XDoG } from '../../implementations/xdog.js';
 *   import { ScalarField } from '../../utils/scalar-field.js';
 *   import { varianceAdaptiveEstimate } from './phi.js';
 *
 *   const phiMap = await varianceAdaptiveEstimate(input, { sigma: 3, phiSoft: 0.01, phiHard: 50 });
 *   const result = await new XDoG({ sigma: 1.4, k: 1.6, epsilon: 0.78 }).process(input, {
 *     phi: ScalarField.fromChannelImage(phiMap),
 *   });
 */

var phi = /*#__PURE__*/Object.freeze({
    __proto__: null,
    toneAdaptiveEstimate: toneAdaptiveEstimate,
    toneAdaptiveEstimateAuto: toneAdaptiveEstimateAuto,
    varianceAdaptiveEstimate: varianceAdaptiveEstimate
});

var index$2 = /*#__PURE__*/Object.freeze({
    __proto__: null,
    epsilon: epsilon,
    p: p,
    phi: phi
});

/**
 * Preprocessing module for XDoG/FDoG
 *
 * Provides filters to prepare images before line detection.
 * These help reduce noise and texture while preserving important edges.
 *
 * Section 3.2 of the paper discusses the importance of bilateral
 * preprocessing for "indication" - attenuating weak edges while
 * preserving strong edges.
 */
const DEFAULT_BILATERAL_CONFIG$2 = {
    sigmaSpatial: 3,
    sigmaRange: 0.1,
    radiusMultiplier: 2,
};
const DEFAULT_MEDIAN_CONFIG$2 = {
    radius: 2,
};
const DEFAULT_KUWAHARA_CONFIG$2 = {
    radius: 3,
};
/**
 * Bilateral Filter
 *
 * Edge-preserving smoothing filter that averages pixels based on both
 * spatial proximity AND intensity similarity. This smooths out texture
 * (like grass) while keeping strong edges (like the car outline) sharp.
 *
 * This is the recommended preprocessing for most images.
 *
 * As mentioned in Section 3.2, bilateral filtering can serve as a
 * "prioritization mechanism" for indication - attenuating weak edges
 * while supporting strong edges.
 *
 * CPU is always available (BaseCPUStrategy.isSupported() / dispose() /
 * backend all apply unchanged). This is the universal fallback.
 */
let BilateralFilter$1 = class BilateralFilter extends BaseCPUStrategy {
    config;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_BILATERAL_CONFIG$2, ...config };
    }
    async process(input) {
        const cfg = this.config;
        const { width, height } = input;
        const output = createChannelImage$1(width, height);
        const radius = Math.ceil(cfg.sigmaSpatial * (cfg.radiusMultiplier ?? 2));
        const sigmaSpatial2 = 2 * cfg.sigmaSpatial * cfg.sigmaSpatial;
        const sigmaRange2 = 2 * cfg.sigmaRange * cfg.sigmaRange;
        // Precompute spatial weights
        const spatialWeights = [];
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const dist2 = dx * dx + dy * dy;
                spatialWeights.push(Math.exp(-dist2 / sigmaSpatial2));
            }
        }
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const centerValue = getPixel(input, x, y);
                let sum = 0;
                let weightSum = 0;
                let idx = 0;
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        const neighborValue = getPixel(input, nx, ny);
                        // Range weight based on intensity difference
                        const intensityDiff = neighborValue - centerValue;
                        const rangeWeight = Math.exp(-(intensityDiff * intensityDiff) / sigmaRange2);
                        // Combined weight
                        const weight = spatialWeights[idx] * rangeWeight;
                        sum += neighborValue * weight;
                        weightSum += weight;
                        idx++;
                    }
                }
                output.data[y * width + x] = weightSum > 0 ? sum / weightSum : centerValue;
            }
        }
        return output;
    }
};
/**
 * Median Filter
 *
 * Replaces each pixel with the median of its neighborhood.
 * Excellent for removing salt-and-pepper noise and small texture details.
 */
let MedianFilter$1 = class MedianFilter extends BaseCPUStrategy {
    config;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_MEDIAN_CONFIG$2, ...config };
    }
    async process(input) {
        const { width, height } = input;
        const output = createChannelImage$1(width, height);
        const radius = this.config.radius;
        const kernelSize = (2 * radius + 1) * (2 * radius + 1);
        const values = new Array(kernelSize);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let idx = 0;
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        values[idx++] = getPixel(input, x + dx, y + dy);
                    }
                }
                // Sort and take median
                values.sort((a, b) => a - b);
                output.data[y * width + x] = values[Math.floor(kernelSize / 2)];
            }
        }
        return output;
    }
};
/**
 * Kuwahara Filter
 *
 * Artistic smoothing filter that creates a painterly effect.
 * Divides the neighborhood into 4 quadrants, finds the one with
 * lowest variance, and uses its mean. Creates flat regions with
 * preserved edges - great for a more stylized look.
 */
let KuwaharaFilter$1 = class KuwaharaFilter extends BaseCPUStrategy {
    config;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_KUWAHARA_CONFIG$2, ...config };
    }
    async process(input) {
        const { width, height } = input;
        const output = createChannelImage$1(width, height);
        const r = this.config.radius;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                // Four quadrants: top-left, top-right, bottom-left, bottom-right
                const quadrants = [
                    { startX: -r, endX: 0, startY: -r, endY: 0 },
                    { startX: 0, endX: r, startY: -r, endY: 0 },
                    { startX: -r, endX: 0, startY: 0, endY: r },
                    { startX: 0, endX: r, startY: 0, endY: r },
                ];
                let minVariance = Infinity;
                let bestMean = getPixel(input, x, y);
                for (const q of quadrants) {
                    let sum = 0;
                    let sumSq = 0;
                    let count = 0;
                    for (let dy = q.startY; dy <= q.endY; dy++) {
                        for (let dx = q.startX; dx <= q.endX; dx++) {
                            const val = getPixel(input, x + dx, y + dy);
                            sum += val;
                            sumSq += val * val;
                            count++;
                        }
                    }
                    const mean = sum / count;
                    const variance = (sumSq / count) - (mean * mean);
                    if (variance < minVariance) {
                        minVariance = variance;
                        bestMean = mean;
                    }
                }
                output.data[y * width + x] = bestMean;
            }
        }
        return output;
    }
};
/**
 * Gaussian Blur
 *
 * Simple Gaussian smoothing. Less edge-preserving than bilateral,
 * but faster. Good for very noisy images or when used with small sigma.
 */
let GaussianBlur$1 = class GaussianBlur extends BaseCPUStrategy {
    sigma;
    constructor(sigma = 1.0) {
        super();
        this.sigma = sigma;
    }
    async process(input) {
        const { width, height } = input;
        const sigma = this.sigma;
        if (sigma < 0.1) {
            return { data: new Float32Array(input.data), width, height };
        }
        const radius = Math.ceil(sigma * 3);
        const kernelSize = radius * 2 + 1;
        const kernel = generateGaussianKernel$1(sigma, kernelSize);
        // Horizontal pass
        const temp = createChannelImage$1(width, height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let val = 0;
                for (let k = 0; k < kernelSize; k++) {
                    val += getPixel(input, x + k - radius, y) * kernel[k];
                }
                temp.data[y * width + x] = val;
            }
        }
        // Vertical pass
        const output = createChannelImage$1(width, height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let val = 0;
                for (let k = 0; k < kernelSize; k++) {
                    val += getPixel(temp, x, y + k - radius) * kernel[k];
                }
                output.data[y * width + x] = val;
            }
        }
        return output;
    }
};
/**
 * Contrast Enhancement
 *
 * Stretches the histogram to use the full 0-1 range.
 * Can help make edges more distinct before processing.
 */
let ContrastEnhancer$1 = class ContrastEnhancer extends BaseCPUStrategy {
    blackPoint;
    whitePoint;
    constructor(blackPoint = 0.01, whitePoint = 0.99) {
        super();
        this.blackPoint = blackPoint;
        this.whitePoint = whitePoint;
    }
    async process(input) {
        const { width, height, data } = input;
        const output = createChannelImage$1(width, height);
        const size = width * height;
        // Find histogram percentiles
        const sorted = new Float32Array(data).sort();
        const minVal = sorted[Math.floor(size * this.blackPoint)];
        const maxVal = sorted[Math.floor(size * this.whitePoint)];
        const range = maxVal - minVal;
        if (range < 0.01) {
            return { data: new Float32Array(data), width, height };
        }
        for (let i = 0; i < size; i++) {
            output.data[i] = Math.max(0, Math.min(1, (data[i] - minVal) / range));
        }
        return output;
    }
};
/**
 * Quantize to reduce color levels
 *
 * Reduces the number of intensity levels, creating a posterized effect.
 * Can help reduce noise by grouping similar intensities together.
 */
let Quantizer$1 = class Quantizer extends BaseCPUStrategy {
    levels;
    constructor(levels = 8) {
        super();
        this.levels = levels;
    }
    async process(input) {
        const { width, height, data } = input;
        const output = createChannelImage$1(width, height);
        const size = width * height;
        const step = 1 / (this.levels - 1);
        for (let i = 0; i < size; i++) {
            output.data[i] = Math.round(data[i] / step) * step;
        }
        return output;
    }
};
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
    /** CPU-only. No WebGL/WebGPU counterparts for this yet. */
    backend = 'cpu';
    constructor(config = {}) {
        this.config = {
            windowRadius: config.windowRadius ?? 2,
            normalizeByGradient: config.normalizeByGradient ?? true,
            varianceScale: config.varianceScale ?? 1.0,
            maxVariance: config.maxVariance,
        };
    }
    dispose() {
        // No resources to release.
    }
    /**
     * Process using separable convolution (faster for large windows)
     * Variance = E[X^2] - E[X]^2
     * Compute box blur of X and X^2 separately, then combine
     */
    async process(image) {
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

/**
 * Shared machinery for "pick the best supported backend, fall back
 * gracefully if it fails later" preprocessors.
 */
class ResilientPreprocessor {
    candidates;
    config;
    failedBackends = new Set();
    instance;
    currentCtor;
    /**
     * Subclasses resolve their instance via `resolve()` *before* calling
     * this (in their own async static `create()`), then hand the result in
     * here. The constructor itself stays synchronous, as constructors must.
     */
    constructor(candidates, resolved, config) {
        this.candidates = candidates;
        this.config = config;
        this.instance = resolved.instance;
        this.currentCtor = resolved.ctor;
    }
    /**
     * Try each candidate in order, skipping unsupported ones. If a
     * candidate reports supported but throws on construction anyway
     * (isSupported() lied), move on to the next.
     */
    static async resolve(candidates, config) {
        for (const Ctor of candidates) {
            if (await Ctor.isSupported()) {
                try {
                    return { instance: new Ctor(config), ctor: Ctor };
                }
                catch {
                    continue;
                }
            }
        }
        throw new Error('No supported preprocessor implementation available');
    }
    get backend() {
        return this.instance.backend;
    }
    dispose() {
        this.instance.dispose();
    }
    async process(input) {
        let current = this.instance;
        while (true) {
            try {
                console.log(`${this.constructor.name}: Running ${current.backend}`);
                return await current.process(input);
            }
            catch (err) {
                console.warn(`${this.constructor.name}: [${this.currentCtor.name}] process() failed, attempting fallback:`, err);
                const fallback = await this.demoteAndFindNext();
                if (!fallback)
                    throw err;
                current = fallback;
            }
        }
    }
    async demoteAndFindNext() {
        this.failedBackends.add(this.currentCtor);
        this.instance.dispose();
        for (const Ctor of this.candidates) {
            if (this.failedBackends.has(Ctor))
                continue;
            if (await Ctor.isSupported()) {
                try {
                    this.instance = new Ctor(this.config);
                    this.currentCtor = Ctor;
                    console.warn(`Falling back to ${Ctor.name}`);
                    return this.instance;
                }
                catch (err) {
                    console.warn(`[${Ctor.name}] construction failed despite isSupported():`, err);
                    this.failedBackends.add(Ctor);
                }
            }
        }
        return null;
    }
}

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/preprocessors/shaders/webgl/bilateral.glsl
// Regenerate with `npm run build:shaders`.
const source$e = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform float u_sigmaSpatial2;
uniform float u_sigmaRange2;
uniform int u_radius;

void main() {
  float centerValue = texture(u_image, v_texCoord).r;
  
  float sum = 0.0;
  float weightSum = 0.0;
  
  for (int dy = -u_radius; dy <= u_radius; dy++) {
    for (int dx = -u_radius; dx <= u_radius; dx++) {
      vec2 offset = vec2(float(dx), float(dy)) * u_texelSize;
      float neighborValue = texture(u_image, v_texCoord + offset).r;
      
      // Spatial weight
      float dist2 = float(dx * dx + dy * dy);
      float spatialWeight = exp(-dist2 / u_sigmaSpatial2);
      
      // Range weight
      float diff = neighborValue - centerValue;
      float rangeWeight = exp(-(diff * diff) / u_sigmaRange2);
      
      float weight = spatialWeight * rangeWeight;
      sum += neighborValue * weight;
      weightSum += weight;
    }
  }
  
  float result = weightSum > 0.0 ? sum / weightSum : centerValue;
  fragColor = vec4(result, 0.0, 0.0, 1.0);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/preprocessors/shaders/webgl/contrast.glsl
// Regenerate with `npm run build:shaders`.
const source$d = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform float u_minVal;
uniform float u_maxVal;

void main() {
  float value = texture(u_image, v_texCoord).r;
  float range = u_maxVal - u_minVal;
  
  float result = range > 0.01 
    ? clamp((value - u_minVal) / range, 0.0, 1.0)
    : value;
    
  fragColor = vec4(result, 0.0, 0.0, 1.0);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/preprocessors/shaders/webgl/guassian-horizontal.glsl
// Regenerate with `npm run build:shaders`.
const source$c = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform float u_texelSizeX;
uniform int u_radius;
uniform float u_sigma2;

void main() {
  float sum = 0.0;
  float weightSum = 0.0;
  
  for (int dx = -u_radius; dx <= u_radius; dx++) {
    float offset = float(dx) * u_texelSizeX;
    float value = texture(u_image, v_texCoord + vec2(offset, 0.0)).r;
    
    float weight = exp(-float(dx * dx) / u_sigma2);
    sum += value * weight;
    weightSum += weight;
  }
  
  fragColor = vec4(sum / weightSum, 0.0, 0.0, 1.0);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/preprocessors/shaders/webgl/guassian-vertical.glsl
// Regenerate with `npm run build:shaders`.
const source$b = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform float u_texelSizeY;
uniform int u_radius;
uniform float u_sigma2;

void main() {
  float sum = 0.0;
  float weightSum = 0.0;
  
  for (int dy = -u_radius; dy <= u_radius; dy++) {
    float offset = float(dy) * u_texelSizeY;
    float value = texture(u_image, v_texCoord + vec2(0.0, offset)).r;
    
    float weight = exp(-float(dy * dy) / u_sigma2);
    sum += value * weight;
    weightSum += weight;
  }
  
  fragColor = vec4(sum / weightSum, 0.0, 0.0, 1.0);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/preprocessors/shaders/webgl/kuwahara.glsl
// Regenerate with `npm run build:shaders`.
const source$a = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform int u_radius;

// Calculate mean and variance for a quadrant
vec2 quadrantStats(vec2 center, int startX, int endX, int startY, int endY) {
  float sum = 0.0;
  float sumSq = 0.0;
  float count = 0.0;
  
  for (int dy = startY; dy <= endY; dy++) {
    for (int dx = startX; dx <= endX; dx++) {
      vec2 offset = vec2(float(dx), float(dy)) * u_texelSize;
      float val = texture(u_image, center + offset).r;
      sum += val;
      sumSq += val * val;
      count += 1.0;
    }
  }
  
  float mean = sum / count;
  float variance = (sumSq / count) - (mean * mean);
  
  return vec2(mean, variance);
}

void main() {
  int r = u_radius;
  
  // Four quadrants: top-left, top-right, bottom-left, bottom-right
  vec2 q0 = quadrantStats(v_texCoord, -r, 0, -r, 0);
  vec2 q1 = quadrantStats(v_texCoord, 0, r, -r, 0);
  vec2 q2 = quadrantStats(v_texCoord, -r, 0, 0, r);
  vec2 q3 = quadrantStats(v_texCoord, 0, r, 0, r);
  
  // Find quadrant with minimum variance
  float minVar = q0.y;
  float result = q0.x;
  
  if (q1.y < minVar) { minVar = q1.y; result = q1.x; }
  if (q2.y < minVar) { minVar = q2.y; result = q2.x; }
  if (q3.y < minVar) { result = q3.x; }
  
  fragColor = vec4(result, 0.0, 0.0, 1.0);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/preprocessors/shaders/webgl/median-small.glsl
// Regenerate with `npm run build:shaders`.
const source$9 = `// For small radius, use direct sorting approach (more accurate)
#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform int u_radius;

// Partial sort network for finding median of small kernels
// This is exact for radius 1-2 (3x3 to 5x5 kernels)

void swap(inout float a, inout float b) {
  float t = min(a, b);
  b = max(a, b);
  a = t;
}

void main() {
  // Collect all values
  float values[25]; // Max 5x5
  int count = 0;
  
  for (int dy = -u_radius; dy <= u_radius; dy++) {
    for (int dx = -u_radius; dx <= u_radius; dx++) {
      vec2 offset = vec2(float(dx), float(dy)) * u_texelSize;
      values[count] = texture(u_image, v_texCoord + offset).r;
      count++;
    }
  }
  
  // Partial bubble sort to find median
  int medianIdx = count / 2;
  
  for (int i = 0; i <= medianIdx; i++) {
    for (int j = i + 1; j < count; j++) {
      swap(values[i], values[j]);
    }
  }
  
  fragColor = vec4(values[medianIdx], 0.0, 0.0, 1.0);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/preprocessors/shaders/webgl/median.glsl
// Regenerate with `npm run build:shaders`.
const source$8 = `// True median requires sorting which isn't efficient in shaders.
// We use a weighted percentile approximation that's very close to median.
#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform int u_radius;

// Histogram-based median approximation
// We use 32 bins for speed while maintaining accuracy
#define NUM_BINS 32

void main() {
  float bins[NUM_BINS];
  for (int i = 0; i < NUM_BINS; i++) bins[i] = 0.0;
  
  float totalWeight = 0.0;
  int kernelSize = (2 * u_radius + 1) * (2 * u_radius + 1);
  
  // Build histogram
  for (int dy = -u_radius; dy <= u_radius; dy++) {
    for (int dx = -u_radius; dx <= u_radius; dx++) {
      vec2 offset = vec2(float(dx), float(dy)) * u_texelSize;
      float value = texture(u_image, v_texCoord + offset).r;
      
      // Map value to bin
      int binIdx = int(clamp(value * float(NUM_BINS - 1), 0.0, float(NUM_BINS - 1)));
      bins[binIdx] += 1.0;
      totalWeight += 1.0;
    }
  }
  
  // Find median (50th percentile)
  float targetWeight = totalWeight * 0.5;
  float cumWeight = 0.0;
  float median = 0.5;
  
  for (int i = 0; i < NUM_BINS; i++) {
    cumWeight += bins[i];
    if (cumWeight >= targetWeight) {
      median = (float(i) + 0.5) / float(NUM_BINS);
      break;
    }
  }
  
  fragColor = vec4(median, 0.0, 0.0, 1.0);
}`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/preprocessors/shaders/webgl/quantize.glsl
// Regenerate with `npm run build:shaders`.
const source$7 = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform float u_levels;

void main() {
  float value = texture(u_image, v_texCoord).r;
  float step = 1.0 / (u_levels - 1.0);
  float result = floor(value / step + 0.5) * step;
  fragColor = vec4(clamp(result, 0.0, 1.0), 0.0, 0.0, 1.0);
}`;

// Default config values (mirrors the CPU implementation in cpu.ts)
const DEFAULT_BILATERAL_CONFIG$1 = {
    sigmaSpatial: 3,
    sigmaRange: 0.1,
    radiusMultiplier: 2,
};
const DEFAULT_MEDIAN_CONFIG$1 = {
    radius: 2,
};
const DEFAULT_KUWAHARA_CONFIG$1 = {
    radius: 3,
};
// ============================================================================
// WebGL Context Management
// ============================================================================
let gl = null;
let canvas = null;
// Shader program cache
const programCache = new Map();
// Reusable geometry buffers
let quadVAO = null;
/**
 * Check if running in a WebWorker context
 */
function isWorkerContext() {
    return typeof document === 'undefined';
}
/**
 * Initialize or get WebGL context
 */
function getGL() {
    if (gl)
        return gl;
    try {
        let glCanvas;
        // Use OffscreenCanvas in WebWorker, HTMLCanvasElement in main thread
        if (isWorkerContext()) {
            glCanvas = new OffscreenCanvas(1, 1);
        }
        else {
            glCanvas = document.createElement('canvas');
        }
        glCanvas.width = 1;
        glCanvas.height = 1;
        gl = glCanvas.getContext('webgl2', {
            alpha: false,
            antialias: false,
            depth: false,
            stencil: false,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: false,
        });
        if (!gl) {
            console.warn('WebGL 2.0 not available');
            return null;
        }
        // Enable required extensions for float textures
        const ext1 = gl.getExtension('EXT_color_buffer_float');
        if (!ext1) {
            console.warn('EXT_color_buffer_float not available, some features may be limited');
        }
        canvas = glCanvas;
        // Setup reusable quad geometry
        setupQuadGeometry();
        return gl;
    }
    catch (err) {
        console.error('WebGL initialization failed:', err);
        return null;
    }
}
/**
 * Setup fullscreen quad VAO (reused for all render passes)
 */
function setupQuadGeometry() {
    if (!gl)
        return;
    quadVAO = gl.createVertexArray();
    gl.bindVertexArray(quadVAO);
    // Positions: fullscreen quad in clip space
    const positions = new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        1, 1,
    ]);
    // Texture coordinates
    const texCoords = new Float32Array([
        0, 0,
        1, 0,
        0, 1,
        1, 1,
    ]);
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const texBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
}
// ============================================================================
// Shader Compilation Utilities
// ============================================================================
const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;
out vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;
function compileShader(source, type) {
    if (!gl)
        return null;
    const shader = gl.createShader(type);
    if (!shader)
        return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}
function createProgram(fragmentSource, cacheKey) {
    if (!gl)
        return null;
    // Check cache first
    const cached = programCache.get(cacheKey);
    if (cached)
        return cached;
    const vertShader = compileShader(VERTEX_SHADER, gl.VERTEX_SHADER);
    const fragShader = compileShader(fragmentSource, gl.FRAGMENT_SHADER);
    if (!vertShader || !fragShader)
        return null;
    const program = gl.createProgram();
    if (!program)
        return null;
    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    // Cleanup shaders (they're now part of the program)
    gl.deleteShader(vertShader);
    gl.deleteShader(fragShader);
    // Cache the program
    programCache.set(cacheKey, program);
    return program;
}
// ============================================================================
// Texture and Framebuffer Utilities
// ============================================================================
function createInputTexture(data, width, height) {
    if (!gl)
        return null;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // Upload grayscale data as R32F
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return texture;
}
function createFramebuffer(width, height) {
    if (!gl)
        return null;
    const fb = gl.createFramebuffer();
    const tex = gl.createTexture();
    if (!fb || !tex)
        return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.error('Framebuffer incomplete:', status);
        gl.deleteFramebuffer(fb);
        gl.deleteTexture(tex);
        return null;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex };
}
function readResult(fb, width, height) {
    if (!gl)
        return new Float32Array(0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const pixels = new Float32Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixels);
    // Extract red channel only
    const result = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        result[i] = pixels[i * 4];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return result;
}
function renderPass(program, inputTex, outputFb, width, height, uniforms) {
    if (!gl || !quadVAO)
        return;
    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, outputFb);
    gl.viewport(0, 0, width, height);
    // Bind input texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTex);
    gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
    // Set uniforms
    for (const [name, value] of Object.entries(uniforms)) {
        const loc = gl.getUniformLocation(program, name);
        if (loc === null)
            continue;
        if (Array.isArray(value)) {
            if (value.length === 2)
                gl.uniform2fv(loc, value);
            else if (value.length === 3)
                gl.uniform3fv(loc, value);
            else if (value.length === 4)
                gl.uniform4fv(loc, value);
        }
        else if (Number.isInteger(value)) {
            gl.uniform1i(loc, value);
        }
        else {
            gl.uniform1f(loc, value);
        }
    }
    // Draw
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
}
// ============================================================================
// BILATERAL FILTER - WebGL Implementation
// ============================================================================
class BilateralFilterWebGL extends BaseWebGLStrategy {
    config;
    static async isSupported() {
        return isWebGLAvailable();
    }
    static async getUnsupportedReason() {
        return isWebGLAvailable() ? undefined : 'WebGL 2.0 is not available in this environment';
    }
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_BILATERAL_CONFIG$1, ...config };
    }
    async process(input) {
        const config = this.config;
        const gl = getGL();
        if (!gl) {
            throw new Error('BilateralFilterWebGL: WebGL 2.0 is not available in this environment.');
        }
        const { width, height, data } = input;
        const sigmaSpatial = config.sigmaSpatial;
        const sigmaRange = config.sigmaRange;
        const radiusMultiplier = config.radiusMultiplier ?? 2;
        const radius = Math.ceil(sigmaSpatial * radiusMultiplier);
        // Resize canvas if needed
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        return this.runGuarded(gl, () => {
            const program = createProgram(source$e, 'bilateral');
            if (!program) {
                throw new Error('BilateralFilterWebGL: failed to compile/link shader program.');
            }
            const inputTex = createInputTexture(data, width, height);
            const output = createFramebuffer(width, height);
            if (!inputTex || !output) {
                if (inputTex)
                    gl.deleteTexture(inputTex);
                throw new Error('BilateralFilterWebGL: failed to create input texture or framebuffer.');
            }
            renderPass(program, inputTex, output.fb, width, height, {
                u_texelSize: [1.0 / width, 1.0 / height],
                u_sigmaSpatial2: 2.0 * sigmaSpatial * sigmaSpatial,
                u_sigmaRange2: 2.0 * sigmaRange * sigmaRange,
                u_radius: radius,
            });
            const result = readResult(output.fb, width, height);
            // Cleanup
            gl.deleteTexture(inputTex);
            gl.deleteTexture(output.tex);
            gl.deleteFramebuffer(output.fb);
            return { data: result, width, height };
        });
    }
}
// ============================================================================
// GAUSSIAN BLUR - Separable WebGL Implementation (Very Fast)
// ============================================================================
class GaussianBlurWebGL extends BaseWebGLStrategy {
    sigma;
    static async isSupported() {
        return isWebGLAvailable();
    }
    static async getUnsupportedReason() {
        return isWebGLAvailable() ? undefined : 'WebGL 2.0 is not available in this environment';
    }
    constructor(sigma = 1.0) {
        super();
        this.sigma = sigma;
    }
    async process(input) {
        const sigma = this.sigma;
        if (sigma < 0.1) {
            return { data: new Float32Array(input.data), width: input.width, height: input.height };
        }
        const gl = getGL();
        if (!gl) {
            throw new Error('GaussianBlurWebGL: WebGL 2.0 is not available in this environment.');
        }
        const { width, height, data } = input;
        const radius = Math.ceil(sigma * 3);
        const sigma2 = 2.0 * sigma * sigma;
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        return this.runGuarded(gl, () => {
            const hProgram = createProgram(source$c, 'gaussianH');
            const vProgram = createProgram(source$b, 'gaussianV');
            if (!hProgram || !vProgram) {
                throw new Error('GaussianBlurWebGL: failed to compile/link shader program.');
            }
            const inputTex = createInputTexture(data, width, height);
            const tempFb = createFramebuffer(width, height);
            const outputFb = createFramebuffer(width, height);
            if (!inputTex || !tempFb || !outputFb) {
                if (inputTex)
                    gl.deleteTexture(inputTex);
                if (tempFb) {
                    gl.deleteFramebuffer(tempFb.fb);
                    gl.deleteTexture(tempFb.tex);
                }
                throw new Error('GaussianBlurWebGL: failed to create input texture or framebuffer.');
            }
            // Horizontal pass
            renderPass(hProgram, inputTex, tempFb.fb, width, height, {
                u_texelSizeX: 1.0 / width,
                u_radius: radius,
                u_sigma2: sigma2,
            });
            // Vertical pass
            renderPass(vProgram, tempFb.tex, outputFb.fb, width, height, {
                u_texelSizeY: 1.0 / height,
                u_radius: radius,
                u_sigma2: sigma2,
            });
            const result = readResult(outputFb.fb, width, height);
            // Cleanup
            gl.deleteTexture(inputTex);
            gl.deleteTexture(tempFb.tex);
            gl.deleteFramebuffer(tempFb.fb);
            gl.deleteTexture(outputFb.tex);
            gl.deleteFramebuffer(outputFb.fb);
            return { data: result, width, height };
        });
    }
}
// ============================================================================
// MEDIAN FILTER - WebGL Approximation using Weighted Histogram
// ============================================================================
class MedianFilterWebGL extends BaseWebGLStrategy {
    config;
    static async isSupported() {
        return isWebGLAvailable();
    }
    static async getUnsupportedReason() {
        return isWebGLAvailable() ? undefined : 'WebGL 2.0 is not available in this environment';
    }
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_MEDIAN_CONFIG$1, ...config };
    }
    async process(input) {
        const config = this.config;
        const gl = getGL();
        if (!gl) {
            throw new Error('MedianFilterWebGL: WebGL 2.0 is not available in this environment.');
        }
        const { width, height, data } = input;
        const radius = config.radius;
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        return this.runGuarded(gl, () => {
            // Use exact sorting for small kernels, histogram for large
            const shaderSource = radius <= 2 ? source$9 : source$8;
            const cacheKey = radius <= 2 ? 'medianSmall' : 'medianLarge';
            const program = createProgram(shaderSource, cacheKey);
            if (!program) {
                throw new Error('MedianFilterWebGL: failed to compile/link shader program.');
            }
            const inputTex = createInputTexture(data, width, height);
            const output = createFramebuffer(width, height);
            if (!inputTex || !output) {
                if (inputTex)
                    gl.deleteTexture(inputTex);
                throw new Error('MedianFilterWebGL: failed to create input texture or framebuffer.');
            }
            renderPass(program, inputTex, output.fb, width, height, {
                u_texelSize: [1.0 / width, 1.0 / height],
                u_radius: radius,
            });
            const result = readResult(output.fb, width, height);
            // Cleanup
            gl.deleteTexture(inputTex);
            gl.deleteTexture(output.tex);
            gl.deleteFramebuffer(output.fb);
            return { data: result, width, height };
        });
    }
}
// ============================================================================
// KUWAHARA FILTER - WebGL Implementation
// ============================================================================
class KuwaharaFilterWebGL extends BaseWebGLStrategy {
    config;
    static async isSupported() {
        return isWebGLAvailable();
    }
    static async getUnsupportedReason() {
        return isWebGLAvailable() ? undefined : 'WebGL 2.0 is not available in this environment';
    }
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_KUWAHARA_CONFIG$1, ...config };
    }
    async process(input) {
        const config = this.config;
        const gl = getGL();
        if (!gl) {
            throw new Error('KuwaharaFilterWebGL: WebGL 2.0 is not available in this environment.');
        }
        const { width, height, data } = input;
        const radius = config.radius;
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        return this.runGuarded(gl, () => {
            const program = createProgram(source$a, 'kuwahara');
            if (!program) {
                throw new Error('KuwaharaFilterWebGL: failed to compile/link shader program.');
            }
            const inputTex = createInputTexture(data, width, height);
            const output = createFramebuffer(width, height);
            if (!inputTex || !output) {
                if (inputTex)
                    gl.deleteTexture(inputTex);
                throw new Error('KuwaharaFilterWebGL: failed to create input texture or framebuffer.');
            }
            renderPass(program, inputTex, output.fb, width, height, {
                u_texelSize: [1.0 / width, 1.0 / height],
                u_radius: radius,
            });
            const result = readResult(output.fb, width, height);
            // Cleanup
            gl.deleteTexture(inputTex);
            gl.deleteTexture(output.tex);
            gl.deleteFramebuffer(output.fb);
            return { data: result, width, height };
        });
    }
}
// ============================================================================
// CONTRAST ENHANCEMENT - WebGL Implementation
// ============================================================================
class ContrastEnhancerWebGL extends BaseWebGLStrategy {
    blackPoint;
    whitePoint;
    static async isSupported() {
        return isWebGLAvailable();
    }
    static async getUnsupportedReason() {
        return isWebGLAvailable() ? undefined : 'WebGL 2.0 is not available in this environment';
    }
    constructor(blackPoint = 0.01, whitePoint = 0.99) {
        super();
        this.blackPoint = blackPoint;
        this.whitePoint = whitePoint;
    }
    async process(input) {
        const { blackPoint, whitePoint } = this;
        const gl = getGL();
        if (!gl) {
            throw new Error('ContrastEnhancerWebGL: WebGL 2.0 is not available in this environment.');
        }
        const { width, height, data } = input;
        // Calculate percentiles on CPU (fast enough, O(n log n)) - this is
        // inherent to the algorithm, not a fallback path.
        const sorted = new Float32Array(data).sort((a, b) => a - b);
        const minVal = sorted[Math.floor(data.length * blackPoint)];
        const maxVal = sorted[Math.floor(data.length * whitePoint)];
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        return this.runGuarded(gl, () => {
            const program = createProgram(source$d, 'contrast');
            if (!program) {
                throw new Error('ContrastEnhancerWebGL: failed to compile/link shader program.');
            }
            const inputTex = createInputTexture(data, width, height);
            const output = createFramebuffer(width, height);
            if (!inputTex || !output) {
                if (inputTex)
                    gl.deleteTexture(inputTex);
                throw new Error('ContrastEnhancerWebGL: failed to create input texture or framebuffer.');
            }
            renderPass(program, inputTex, output.fb, width, height, {
                u_minVal: minVal,
                u_maxVal: maxVal,
            });
            const result = readResult(output.fb, width, height);
            // Cleanup
            gl.deleteTexture(inputTex);
            gl.deleteTexture(output.tex);
            gl.deleteFramebuffer(output.fb);
            return { data: result, width, height };
        });
    }
}
// ============================================================================
// QUANTIZATION - WebGL Implementation
// ============================================================================
class QuantizerWebGL extends BaseWebGLStrategy {
    levels;
    static async isSupported() {
        return isWebGLAvailable();
    }
    static async getUnsupportedReason() {
        return isWebGLAvailable() ? undefined : 'WebGL 2.0 is not available in this environment';
    }
    constructor(levels = 8) {
        super();
        this.levels = levels;
    }
    async process(input) {
        const levels = this.levels;
        const gl = getGL();
        if (!gl) {
            throw new Error('QuantizerWebGL: WebGL 2.0 is not available in this environment.');
        }
        const { width, height, data } = input;
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        return this.runGuarded(gl, () => {
            const program = createProgram(source$7, 'quantize');
            if (!program) {
                throw new Error('QuantizerWebGL: failed to compile/link shader program.');
            }
            const inputTex = createInputTexture(data, width, height);
            const output = createFramebuffer(width, height);
            if (!inputTex || !output) {
                if (inputTex)
                    gl.deleteTexture(inputTex);
                throw new Error('QuantizerWebGL: failed to create input texture or framebuffer.');
            }
            renderPass(program, inputTex, output.fb, width, height, {
                u_levels: levels,
            });
            const result = readResult(output.fb, width, height);
            // Cleanup
            gl.deleteTexture(inputTex);
            gl.deleteTexture(output.tex);
            gl.deleteFramebuffer(output.fb);
            return { data: result, width, height };
        });
    }
}
// ============================================================================
// UTILITY EXPORTS
// ============================================================================
/**
 * Check if WebGL 2.0 is available
 */
function isWebGLAvailable() {
    return getGL() !== null;
}
/**
 * Cleanup all WebGL resources
 */
function disposeWebGL() {
    if (!gl)
        return;
    // Delete cached programs
    programCache.forEach(program => gl.deleteProgram(program));
    programCache.clear();
    // Delete VAO
    if (quadVAO) {
        gl.deleteVertexArray(quadVAO);
        quadVAO = null;
    }
    gl = null;
    canvas = null;
}

var webgl = /*#__PURE__*/Object.freeze({
    __proto__: null,
    BilateralFilter: BilateralFilterWebGL,
    BilateralFilterWebGL: BilateralFilterWebGL,
    ContrastEnhancer: ContrastEnhancerWebGL,
    ContrastEnhancerWebGL: ContrastEnhancerWebGL,
    GaussianBlur: GaussianBlurWebGL,
    GaussianBlurWebGL: GaussianBlurWebGL,
    KuwaharaFilter: KuwaharaFilterWebGL,
    KuwaharaFilterWebGL: KuwaharaFilterWebGL,
    MedianFilter: MedianFilterWebGL,
    MedianFilterWebGL: MedianFilterWebGL,
    Quantizer: QuantizerWebGL,
    QuantizerWebGL: QuantizerWebGL,
    disposeWebGL: disposeWebGL,
    isWebGLAvailable: isWebGLAvailable
});

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/preprocessors/shaders/webgpu/bilateral.wgsl
// Regenerate with `npm run build:shaders`.
const source$6 = `struct Params {
  width: u32,
  height: u32,
  radius: u32,
  rowOffset: u32,
  sigmaSpatial2: f32,
  sigmaRange2: f32,
  _pad1: f32,
  _pad2: f32,
};

// Pipeline-overridable — real value supplied via
// GPUComputePipelineDescriptor.compute.constants (see getPipeline() in
// webgpu.ts, which injects it for every pipeline by default).
override WORKGROUP_SIZE: u32 = 8u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputImage: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputImage: array<f32>;
@group(0) @binding(3) var<storage, read> spatialWeights: array<f32>;

fn samplePixel(x: i32, y: i32) -> f32 {
  let cx = clamp(x, 0, i32(params.width) - 1);
  let cy = clamp(y, 0, i32(params.height) - 1);
  return inputImage[cy * i32(params.width) + cx];
}

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  // gid.y is relative to the current chunk; rowOffset shifts it back into
  // the coordinate space of the full image.
  let y = i32(gid.y) + i32(params.rowOffset);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }

  let r = i32(params.radius);
  let center = samplePixel(x, y);

  var sum: f32 = 0.0;
  var weightSum: f32 = 0.0;
  var idx: u32 = 0u;

  for (var dy = -r; dy <= r; dy = dy + 1) {
    for (var dx = -r; dx <= r; dx = dx + 1) {
      let neighbor = samplePixel(x + dx, y + dy);
      let diff = neighbor - center;
      let rangeWeight = exp(-(diff * diff) / params.sigmaRange2);
      let weight = spatialWeights[idx] * rangeWeight;
      sum = sum + neighbor * weight;
      weightSum = weightSum + weight;
      idx = idx + 1u;
    }
  }

  outputImage[y * i32(params.width) + x] = select(center, sum / weightSum, weightSum > 0.0);
}
`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/preprocessors/shaders/webgpu/kuwahara.wgsl
// Regenerate with `npm run build:shaders`.
const source$5 = `struct Params {
  width: u32,
  height: u32,
  radius: u32,
  _pad: u32,
};

override WORKGROUP_SIZE: u32 = 8u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputImage: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputImage: array<f32>;

fn samplePixel(x: i32, y: i32) -> f32 {
  let cx = clamp(x, 0, i32(params.width) - 1);
  let cy = clamp(y, 0, i32(params.height) - 1);
  return inputImage[cy * i32(params.width) + cx];
}

fn quadrantStats(x: i32, y: i32, x0: i32, x1: i32, y0: i32, y1: i32) -> vec2<f32> {
  var sum: f32 = 0.0;
  var sumSq: f32 = 0.0;
  var count: f32 = 0.0;
  for (var dy = y0; dy <= y1; dy = dy + 1) {
    for (var dx = x0; dx <= x1; dx = dx + 1) {
      let v = samplePixel(x + dx, y + dy);
      sum = sum + v;
      sumSq = sumSq + v * v;
      count = count + 1.0;
    }
  }
  let mean = sum / count;
  let variance = (sumSq / count) - (mean * mean);
  return vec2<f32>(mean, variance);
}

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }

  let r = i32(params.radius);

  // Four quadrants: top-left, top-right, bottom-left, bottom-right.
  let q0 = quadrantStats(x, y, -r, 0, -r, 0);
  let q1 = quadrantStats(x, y, 0, r, -r, 0);
  let q2 = quadrantStats(x, y, -r, 0, 0, r);
  let q3 = quadrantStats(x, y, 0, r, 0, r);

  var bestMean = q0.x;
  var minVariance = q0.y;

  if (q1.y < minVariance) { minVariance = q1.y; bestMean = q1.x; }
  if (q2.y < minVariance) { minVariance = q2.y; bestMean = q2.x; }
  if (q3.y < minVariance) { minVariance = q3.y; bestMean = q3.x; }

  outputImage[y * i32(params.width) + x] = bestMean;
}
`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/preprocessors/shaders/webgpu/gaussian.wgsl
// Regenerate with `npm run build:shaders`.
const source$4 = `struct Params {
  width: u32,
  height: u32,
  radius: u32,
  _pad: u32,
};

override WORKGROUP_SIZE: u32 = 8u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputImage: array<f32>;
@group(0) @binding(2) var<storage, read> kernelWeights: array<f32>;
@group(0) @binding(3) var<storage, read_write> outputImage: array<f32>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main_h(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }
  let r = i32(params.radius);
  var sum: f32 = 0.0;
  for (var k = 0; k <= 2 * r; k = k + 1) {
    let sx = clamp(x + k - r, 0, i32(params.width) - 1);
    sum = sum + inputImage[y * i32(params.width) + sx] * kernelWeights[k];
  }
  outputImage[y * i32(params.width) + x] = sum;
}

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main_v(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }
  let r = i32(params.radius);
  var sum: f32 = 0.0;
  for (var k = 0; k <= 2 * r; k = k + 1) {
    let sy = clamp(y + k - r, 0, i32(params.height) - 1);
    sum = sum + inputImage[sy * i32(params.width) + x] * kernelWeights[k];
  }
  outputImage[y * i32(params.width) + x] = sum;
}
`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/preprocessors/shaders/webgpu/histogram.wgsl
// Regenerate with `npm run build:shaders`.
const source$3 = `struct Params {
  width: u32,
  height: u32,
  _pad0: u32,
  _pad1: u32,
};

override WORKGROUP_SIZE: u32 = 8u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputImage: array<f32>;
@group(0) @binding(2) var<storage, read_write> histogram: array<atomic<u32>>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }
  let v = clamp(inputImage[y * i32(params.width) + x], 0.0, 1.0);
  let bin = u32(v * 255.0 + 0.5);
  atomicAdd(&histogram[min(bin, 255u)], 1u);
}
`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/preprocessors/shaders/webgpu/stretch.wgsl
// Regenerate with `npm run build:shaders`.
const source$2 = `struct Params {
  width: u32,
  height: u32,
  minVal: f32,
  range: f32,
};

override WORKGROUP_SIZE: u32 = 8u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputImage: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputImage: array<f32>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }
  let idx = y * i32(params.width) + x;
  let v = (inputImage[idx] - params.minVal) / params.range;
  outputImage[idx] = clamp(v, 0.0, 1.0);
}
`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/preprocessors/shaders/webgpu/quantize.wgsl
// Regenerate with `npm run build:shaders`.
const source$1 = `struct Params {
  width: u32,
  height: u32,
  step: f32,
  _pad: f32,
};

override WORKGROUP_SIZE: u32 = 8u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputImage: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputImage: array<f32>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }
  let idx = y * i32(params.width) + x;
  outputImage[idx] = round(inputImage[idx] / params.step) * params.step;
}
`;

// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: preprocess/preprocessors/shaders/webgpu/median.wgsl
// Regenerate with `npm run build:shaders`.
const source = `struct Params {
  width: u32,
  height: u32,
  radius: u32,
  _pad: u32,
};

override WORKGROUP_SIZE: u32 = 8u;

// N (the per-pixel neighborhood size, (2*radius+1)^2) sizes a plain
// function-local \`var\`, not a \`var<workgroup>\` one — WGSL's override-as-
// array-size exception only covers the latter, so N can't become an
// \`override\`. It has to stay a real \`const\`, resolved at shader-module
// creation. That means it genuinely can't be fixed at build time; a new
// module is compiled per distinct radius, same as before. __N__ is
// substituted at runtime in medianShaderSource() (webgpu.ts) — the one
// remaining spot in this codebase that still needs string templating,
// and for a language-level reason rather than convenience.
const N: u32 = __N__u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputImage: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputImage: array<f32>;

fn samplePixel(x: i32, y: i32) -> f32 {
  let cx = clamp(x, 0, i32(params.width) - 1);
  let cy = clamp(y, 0, i32(params.height) - 1);
  return inputImage[cy * i32(params.width) + cx];
}

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= i32(params.width) || y >= i32(params.height)) {
    return;
  }

  let r = i32(params.radius);
  var vals: array<f32, N>;
  var idx: u32 = 0u;
  for (var dy = -r; dy <= r; dy = dy + 1) {
    for (var dx = -r; dx <= r; dx = dx + 1) {
      vals[idx] = samplePixel(x + dx, y + dy);
      idx = idx + 1u;
    }
  }

  // Insertion sort: O(n^2), fine for the small neighborhoods used here
  // (n = (2*radius+1)^2, e.g. 25 at radius 2).
  for (var i = 1u; i < N; i = i + 1u) {
    let key = vals[i];
    var j = i;
    while (j > 0u && vals[j - 1u] > key) {
      vals[j] = vals[j - 1u];
      j = j - 1u;
    }
    vals[j] = key;
  }

  outputImage[y * i32(params.width) + x] = vals[N / 2u];
}
`;

/**
 * WebGPU-accelerated preprocessing module for XDoG/FDoG
 *
 * Even faster than WebGL implementations
 */
/* ==================================================================== */
/* GPU device management                                                */
/* ==================================================================== */
let cachedDevice = null;
let deviceInitPromise = null;
/**
 * Deeper async check: confirms an adapter is actually obtainable, not
 * just that `navigator.gpu` exists.
 */
async function getWebGPUUnsupportedReason() {
    if (typeof navigator === 'undefined' || !navigator.gpu) {
        return 'navigator.gpu is not available in this environment';
    }
    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            return 'No suitable GPU adapter was found';
        }
    }
    catch (err) {
        return `Failed to request a GPU adapter: ${err.message}`;
    }
    return undefined;
}
async function getWebGPUDevice() {
    if (cachedDevice)
        return cachedDevice;
    if (deviceInitPromise)
        return deviceInitPromise;
    deviceInitPromise = (async () => {
        if (!isWebGLComputeSupported()) {
            throw new Error('WebGPU is not supported in this environment (navigator.gpu is missing)');
        }
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            throw new Error('Failed to acquire a WebGPU adapter');
        }
        const device = await adapter.requestDevice();
        device.lost.then((info) => {
            // Invalidate the cache so the next call reinitializes a fresh device.
            cachedDevice = null;
            deviceInitPromise = null;
            clearShaderCaches();
            console.warn(`WebGPU device lost: ${info.message}`);
        });
        cachedDevice = device;
        return device;
    })();
    return deviceInitPromise;
}
/** Release the cached device. Mainly useful for tests / hot reload. */
function disposeWebGPU() {
    cachedDevice?.destroy();
    cachedDevice = null;
    deviceInitPromise = null;
}
/* ==================================================================== */
/* Low-level GPU helpers                                                 */
/* ==================================================================== */
const WORKGROUP_SIZE = 8;
function workgroupCount(size) {
    return Math.ceil(size / WORKGROUP_SIZE);
}
function createUniformBuffer(device, data) {
    const buffer = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data));
    buffer.unmap();
    return buffer;
}
function createReadOnlyStorageBuffer(device, data) {
    const buffer = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
}
function createOutputStorageBuffer(device, byteLength) {
    return device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
}
async function readFloat32Buffer(device, buffer, length) {
    const byteLength = length * 4;
    const staging = device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(buffer, 0, staging, 0, byteLength);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const copy = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return copy;
}
// Shader modules are cached by cacheKey so pipelines that share a module
// (e.g. the two Gaussian blur passes) don't recompile it twice.
const moduleCache = new Map();
const pipelineCache = new Map();
function getShaderModule(device, cacheKey, code) {
    let module = moduleCache.get(cacheKey);
    if (!module) {
        module = device.createShaderModule({ code });
        moduleCache.set(cacheKey, module);
    }
    return module;
}
// in webgpu.ts, near moduleCache/pipelineCache
function clearShaderCaches() {
    moduleCache.clear();
    pipelineCache.clear();
}
function getPipeline(device, cacheKey, code, entryPoint) {
    const key = `${cacheKey}::${entryPoint}`;
    let pipeline = pipelineCache.get(key);
    if (!pipeline) {
        const module = getShaderModule(device, cacheKey, code);
        pipeline = device.createComputePipeline({
            layout: 'auto',
            compute: { module, entryPoint, constants: { WORKGROUP_SIZE } },
        });
        pipelineCache.set(key, pipeline);
    }
    return pipeline;
}
function dispatch(device, pipeline, bindGroup, width, height) {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupCount(width), workgroupCount(height));
    pass.end();
    device.queue.submit([encoder.finish()]);
}
/* ==================================================================== */
/* Bilateral Filter                                                      */
/* ==================================================================== */
const DEFAULT_BILATERAL_CONFIG = {
    sigmaSpatial: 3,
    sigmaRange: 0.1,
    radiusMultiplier: 2,
};
/**
 * The `rowOffset` field lets a single dispatch cover only a band of rows
 * of a much taller image (see the chunking loop in `process()` below).
 * `spatialWeights` is a precomputed (2*radius+1)^2 lookup table for the
 * spatial term of the bilateral weight, which depends only on (dx, dy)
 * and is identical for every pixel. Computing it on the CPU once instead
 * of calling `exp()` for it on every shader invocation roughly halves the
 * transcendental-function work in the inner loop.
 */
class GPUBilateralFilter extends BaseWebGPUStrategy {
    config;
    static async isSupported() {
        return isWebGLComputeSupported() && (await getWebGPUUnsupportedReason()) === undefined;
    }
    static getUnsupportedReason() {
        return getWebGPUUnsupportedReason();
    }
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_BILATERAL_CONFIG, ...config };
    }
    async process(input) {
        const device = await getWebGPUDevice();
        const { width, height } = input;
        const cfg = this.config;
        const radius = Math.ceil(cfg.sigmaSpatial * (cfg.radiusMultiplier ?? 2));
        const side = 2 * radius + 1;
        if (radius > 15) {
            console.warn(`GPUBilateralFilter: radius=${radius} (from sigmaSpatial=${cfg.sigmaSpatial}) means ` +
                `${side * side} samples/pixel. On large images this can still be expensive enough ` +
                `to run long even chunked; consider a smaller sigmaSpatial/radiusMultiplier if you ` +
                `see slowdowns or device loss.`);
        }
        // Precompute the spatial weight term (depends only on dx, dy - identical
        // for every pixel) once on the CPU instead of recomputing it with exp()
        // on every shader invocation for every pixel.
        const spatialLUT = new Float32Array(side * side);
        {
            const sigmaSpatial2 = 2 * cfg.sigmaSpatial * cfg.sigmaSpatial;
            let li = 0;
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    spatialLUT[li++] = Math.exp(-(dx * dx + dy * dy) / sigmaSpatial2);
                }
            }
        }
        const uniformData = new ArrayBuffer(32);
        const u32View = new Uint32Array(uniformData);
        const f32View = new Float32Array(uniformData);
        u32View[0] = width;
        u32View[1] = height;
        u32View[2] = radius;
        u32View[3] = 0; // rowOffset - updated per chunk in the loop below
        f32View[4] = 2 * cfg.sigmaSpatial * cfg.sigmaSpatial;
        f32View[5] = 2 * cfg.sigmaRange * cfg.sigmaRange;
        return this.runGuarded(device, async () => {
            const uniformBuffer = createUniformBuffer(device, uniformData);
            const inputBuffer = createReadOnlyStorageBuffer(device, input.data);
            const outputBuffer = createOutputStorageBuffer(device, input.data.byteLength);
            const spatialWeightsBuffer = createReadOnlyStorageBuffer(device, spatialLUT);
            const pipeline = getPipeline(device, 'bilateral', source$6, 'main');
            const bindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: inputBuffer } },
                    { binding: 2, resource: { buffer: outputBuffer } },
                    { binding: 3, resource: { buffer: spatialWeightsBuffer } },
                ],
            });
            // Large images combined with large radii make width * height *
            // (2*radius+1)^2 samples in a single dispatch, which can run long
            // enough to exceed the GPU driver's watchdog timeout and bring down
            // the whole device (VK_ERROR_DEVICE_LOST) instead of just failing
            // this operation. Splitting the work into row bands, each submitted
            // and awaited independently, keeps any single submission short.
            // ROWS_PER_CHUNK is sized so that each chunk does roughly the same
            // amount of total sampling work regardless of image width or radius.
            const ROWS_PER_CHUNK = Math.max(1, Math.floor(4_000_000 / (width * side * side)));
            for (let y0 = 0; y0 < height; y0 += ROWS_PER_CHUNK) {
                const rows = Math.min(ROWS_PER_CHUNK, height - y0);
                device.queue.writeBuffer(uniformBuffer, 12, new Uint32Array([y0]));
                const encoder = device.createCommandEncoder();
                const pass = encoder.beginComputePass();
                pass.setPipeline(pipeline);
                pass.setBindGroup(0, bindGroup);
                pass.dispatchWorkgroups(workgroupCount(width), workgroupCount(rows));
                pass.end();
                device.queue.submit([encoder.finish()]);
            }
            const resultData = await readFloat32Buffer(device, outputBuffer, width * height);
            uniformBuffer.destroy();
            inputBuffer.destroy();
            outputBuffer.destroy();
            spatialWeightsBuffer.destroy();
            return { data: resultData, width, height };
        });
    }
}
/* ==================================================================== */
/* Median Filter                                                         */
/* ==================================================================== */
const DEFAULT_MEDIAN_CONFIG = {
    radius: 2,
};
// N (the per-pixel neighborhood size) sizes a function-local `var`, not a
// `var<workgroup>` one, so it can't become a WGSL `override`. The
// override-as-array-size exception only covers workgroup-address-space
// arrays (see median.wgsl's comment for the full explanation). It's a
// genuine `const`, so it still has to be baked per radius at the string
// level; a new shader module is compiled (and cached by getPipeline's
// cacheKey) for each distinct radius, same as before this migration.
function medianShaderSource(radius) {
    const side = 2 * radius + 1;
    const n = side * side;
    return source.replace('__N__', String(n));
}
class GPUMedianFilter extends BaseWebGPUStrategy {
    config;
    static async isSupported() {
        return isWebGLComputeSupported() && (await getWebGPUUnsupportedReason()) === undefined;
    }
    static getUnsupportedReason() {
        return getWebGPUUnsupportedReason();
    }
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_MEDIAN_CONFIG, ...config };
        if (this.config.radius > 6) {
            console.warn(`GPUMedianFilter: radius=${this.config.radius} means a per-pixel ` +
                `neighborhood array of ${(2 * this.config.radius + 1) ** 2} elements, ` +
                `sorted in-shader with an O(n^2) insertion sort. This can get slow ` +
                `and register-heavy fast; consider a smaller radius on GPU.`);
        }
    }
    async process(input) {
        const device = await getWebGPUDevice();
        const { width, height } = input;
        const radius = this.config.radius;
        const uniformData = new ArrayBuffer(16);
        const u32View = new Uint32Array(uniformData);
        u32View[0] = width;
        u32View[1] = height;
        u32View[2] = radius;
        return this.runGuarded(device, async () => {
            const uniformBuffer = createUniformBuffer(device, uniformData);
            const inputBuffer = createReadOnlyStorageBuffer(device, input.data);
            const outputBuffer = createOutputStorageBuffer(device, input.data.byteLength);
            const cacheKey = `median-r${radius}`;
            const pipeline = getPipeline(device, cacheKey, medianShaderSource(radius), 'main');
            const bindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: inputBuffer } },
                    { binding: 2, resource: { buffer: outputBuffer } },
                ],
            });
            dispatch(device, pipeline, bindGroup, width, height);
            const resultData = await readFloat32Buffer(device, outputBuffer, width * height);
            uniformBuffer.destroy();
            inputBuffer.destroy();
            outputBuffer.destroy();
            return { data: resultData, width, height };
        });
    }
}
/* ==================================================================== */
/* Kuwahara Filter                                                       */
/* ==================================================================== */
const DEFAULT_KUWAHARA_CONFIG = {
    radius: 3,
};
class GPUKuwaharaFilter extends BaseWebGPUStrategy {
    config;
    static async isSupported() {
        return isWebGLComputeSupported() && (await getWebGPUUnsupportedReason()) === undefined;
    }
    static getUnsupportedReason() {
        return getWebGPUUnsupportedReason();
    }
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_KUWAHARA_CONFIG, ...config };
    }
    async process(input) {
        const device = await getWebGPUDevice();
        const { width, height } = input;
        const radius = this.config.radius;
        const uniformData = new ArrayBuffer(16);
        const u32View = new Uint32Array(uniformData);
        u32View[0] = width;
        u32View[1] = height;
        u32View[2] = radius;
        return this.runGuarded(device, async () => {
            const uniformBuffer = createUniformBuffer(device, uniformData);
            const inputBuffer = createReadOnlyStorageBuffer(device, input.data);
            const outputBuffer = createOutputStorageBuffer(device, input.data.byteLength);
            const pipeline = getPipeline(device, 'kuwahara', source$5, 'main');
            const bindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: inputBuffer } },
                    { binding: 2, resource: { buffer: outputBuffer } },
                ],
            });
            dispatch(device, pipeline, bindGroup, width, height);
            const resultData = await readFloat32Buffer(device, outputBuffer, width * height);
            uniformBuffer.destroy();
            inputBuffer.destroy();
            outputBuffer.destroy();
            return { data: resultData, width, height };
        });
    }
}
/* ==================================================================== */
/* Gaussian Blur (separable, two compute passes)                        */
/* ==================================================================== */
class GPUGaussianBlur extends BaseWebGPUStrategy {
    sigma;
    static async isSupported() {
        return isWebGLComputeSupported() && (await getWebGPUUnsupportedReason()) === undefined;
    }
    static getUnsupportedReason() {
        return getWebGPUUnsupportedReason();
    }
    constructor(sigma = 1.0) {
        super();
        this.sigma = sigma;
    }
    async process(input) {
        const { width, height } = input;
        if (this.sigma < 0.1) {
            return { data: new Float32Array(input.data), width, height };
        }
        const device = await getWebGPUDevice();
        const radius = Math.ceil(this.sigma * 3);
        const kernelSize = radius * 2 + 1;
        const kernel = generateGaussianKernel$1(this.sigma, kernelSize);
        const uniformData = new ArrayBuffer(16);
        const u32View = new Uint32Array(uniformData);
        u32View[0] = width;
        u32View[1] = height;
        u32View[2] = radius;
        return this.runGuarded(device, async () => {
            const uniformBuffer = createUniformBuffer(device, uniformData);
            const inputBuffer = createReadOnlyStorageBuffer(device, input.data);
            const kernelBuffer = createReadOnlyStorageBuffer(device, new Float32Array(kernel));
            const tempBuffer = createOutputStorageBuffer(device, input.data.byteLength);
            const outputBuffer = createOutputStorageBuffer(device, input.data.byteLength);
            const pipelineH = getPipeline(device, 'gaussian', source$4, 'main_h');
            const pipelineV = getPipeline(device, 'gaussian', source$4, 'main_v');
            const bindGroupH = device.createBindGroup({
                layout: pipelineH.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: inputBuffer } },
                    { binding: 2, resource: { buffer: kernelBuffer } },
                    { binding: 3, resource: { buffer: tempBuffer } },
                ],
            });
            const bindGroupV = device.createBindGroup({
                layout: pipelineV.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: tempBuffer } },
                    { binding: 2, resource: { buffer: kernelBuffer } },
                    { binding: 3, resource: { buffer: outputBuffer } },
                ],
            });
            // Both passes are recorded on one command encoder before submission,
            // so the vertical pass reliably waits for the horizontal pass's writes
            // to tempBuffer (WebGPU commands within one queue submission execute
            // in program order with respect to buffer dependencies).
            const encoder = device.createCommandEncoder();
            let pass = encoder.beginComputePass();
            pass.setPipeline(pipelineH);
            pass.setBindGroup(0, bindGroupH);
            pass.dispatchWorkgroups(workgroupCount(width), workgroupCount(height));
            pass.end();
            pass = encoder.beginComputePass();
            pass.setPipeline(pipelineV);
            pass.setBindGroup(0, bindGroupV);
            pass.dispatchWorkgroups(workgroupCount(width), workgroupCount(height));
            pass.end();
            device.queue.submit([encoder.finish()]);
            const resultData = await readFloat32Buffer(device, outputBuffer, width * height);
            uniformBuffer.destroy();
            inputBuffer.destroy();
            kernelBuffer.destroy();
            tempBuffer.destroy();
            outputBuffer.destroy();
            return { data: resultData, width, height };
        });
    }
}
/* ==================================================================== */
/* Contrast Enhancement (histogram-based percentile approximation)      */
/* ==================================================================== */
class GPUContrastEnhancer extends BaseWebGPUStrategy {
    blackPoint;
    whitePoint;
    static async isSupported() {
        return isWebGLComputeSupported() && (await getWebGPUUnsupportedReason()) === undefined;
    }
    static getUnsupportedReason() {
        return getWebGPUUnsupportedReason();
    }
    constructor(blackPoint = 0.01, whitePoint = 0.99) {
        super();
        this.blackPoint = blackPoint;
        this.whitePoint = whitePoint;
    }
    /**
     * The CPU version sorts every pixel to find exact percentiles. Sorting
     * is a poor fit for a GPU compute pass, so this builds a 256-bin
     * histogram instead (one atomicAdd per pixel), reads the 1KB histogram
     * back to the CPU to locate the percentile bins, then runs a second,
     * fully GPU-resident pass to apply the stretch. This trades a small
     * amount of precision (bin width 1/255) for O(n) work instead of an
     * O(n log n) sort, at the cost of one small CPU/GPU sync point.
     *
     * The two GPU round-trips (histogram pass, then stretch pass) are each
     * wrapped in their own runGuarded scope rather than one scope spanning
     * both. The CPU-side histogram bucketing that happens between them
     * isn't GPU work, so it shouldn't sit inside a WebGPU error scope.
     */
    async process(input) {
        const device = await getWebGPUDevice();
        const { width, height } = input;
        const size = width * height;
        const histUniform = new ArrayBuffer(16);
        new Uint32Array(histUniform).set([width, height, 0, 0]);
        const histogramU32 = await this.runGuarded(device, async () => {
            const histUniformBuffer = createUniformBuffer(device, histUniform);
            const histInputBuffer = createReadOnlyStorageBuffer(device, input.data);
            const histogramBuffer = device.createBuffer({
                size: 256 * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
            });
            device.queue.writeBuffer(histogramBuffer, 0, new Uint32Array(256));
            const histPipeline = getPipeline(device, 'histogram', source$3, 'main');
            const histBindGroup = device.createBindGroup({
                layout: histPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: histUniformBuffer } },
                    { binding: 1, resource: { buffer: histInputBuffer } },
                    { binding: 2, resource: { buffer: histogramBuffer } },
                ],
            });
            dispatch(device, histPipeline, histBindGroup, width, height);
            const result = await readUint32Buffer(device, histogramBuffer, 256);
            histUniformBuffer.destroy();
            histInputBuffer.destroy();
            histogramBuffer.destroy();
            return result;
        });
        const blackCount = this.blackPoint * size;
        const whiteCount = this.whitePoint * size;
        let cumulative = 0;
        let minBin = 0;
        let maxBin = 255;
        let foundMin = false;
        for (let bin = 0; bin < 256; bin++) {
            cumulative += histogramU32[bin];
            if (!foundMin && cumulative >= blackCount) {
                minBin = bin;
                foundMin = true;
            }
            if (cumulative >= whiteCount) {
                maxBin = bin;
                break;
            }
        }
        const minVal = minBin / 255;
        const maxVal = maxBin / 255;
        const range = maxVal - minVal;
        if (range < 0.01) {
            return { data: new Float32Array(input.data), width, height };
        }
        const stretchUniform = new ArrayBuffer(16);
        const stretchU32 = new Uint32Array(stretchUniform);
        const stretchF32 = new Float32Array(stretchUniform);
        stretchU32[0] = width;
        stretchU32[1] = height;
        stretchF32[2] = minVal;
        stretchF32[3] = range;
        return this.runGuarded(device, async () => {
            const stretchUniformBuffer = createUniformBuffer(device, stretchUniform);
            const stretchInputBuffer = createReadOnlyStorageBuffer(device, input.data);
            const outputBuffer = createOutputStorageBuffer(device, input.data.byteLength);
            const stretchPipeline = getPipeline(device, 'stretch', source$2, 'main');
            const stretchBindGroup = device.createBindGroup({
                layout: stretchPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: stretchUniformBuffer } },
                    { binding: 1, resource: { buffer: stretchInputBuffer } },
                    { binding: 2, resource: { buffer: outputBuffer } },
                ],
            });
            dispatch(device, stretchPipeline, stretchBindGroup, width, height);
            const resultData = await readFloat32Buffer(device, outputBuffer, width * height);
            stretchUniformBuffer.destroy();
            stretchInputBuffer.destroy();
            outputBuffer.destroy();
            return { data: resultData, width, height };
        });
    }
}
async function readUint32Buffer(device, buffer, length) {
    const byteLength = length * 4;
    const staging = device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(buffer, 0, staging, 0, byteLength);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const copy = new Uint32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return copy;
}
/* ==================================================================== */
/* Quantizer                                                             */
/* ==================================================================== */
class GPUQuantizer extends BaseWebGPUStrategy {
    levels;
    static async isSupported() {
        return isWebGLComputeSupported() && (await getWebGPUUnsupportedReason()) === undefined;
    }
    static getUnsupportedReason() {
        return getWebGPUUnsupportedReason();
    }
    constructor(levels = 8) {
        super();
        this.levels = levels;
    }
    async process(input) {
        const device = await getWebGPUDevice();
        const { width, height } = input;
        const step = 1 / (this.levels - 1);
        const uniformData = new ArrayBuffer(16);
        const u32View = new Uint32Array(uniformData);
        const f32View = new Float32Array(uniformData);
        u32View[0] = width;
        u32View[1] = height;
        f32View[2] = step;
        return this.runGuarded(device, async () => {
            const uniformBuffer = createUniformBuffer(device, uniformData);
            const inputBuffer = createReadOnlyStorageBuffer(device, input.data);
            const outputBuffer = createOutputStorageBuffer(device, input.data.byteLength);
            const pipeline = getPipeline(device, 'quantize', source$1, 'main');
            const bindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: inputBuffer } },
                    { binding: 2, resource: { buffer: outputBuffer } },
                ],
            });
            dispatch(device, pipeline, bindGroup, width, height);
            const resultData = await readFloat32Buffer(device, outputBuffer, width * height);
            uniformBuffer.destroy();
            inputBuffer.destroy();
            outputBuffer.destroy();
            return { data: resultData, width, height };
        });
    }
}

/**
 * Composed Preprocessing Module for XDoG/FDoG
 *
 * This module is the single entry point the rest of the codebase should
 * import from. Each exported class resolves its OWN best-supported
 * backend independently (WebGPU > WebGL > CPU), the first time it's
 * created:
 *
 *   BilateralFilter.create(...)  // may end up WebGPU on this device
 *   MedianFilter.create(...)     // may end up WebGL on this device, if
 *                                // e.g. it needs a storage texture format
 *                                // WebGPU can't provide here
 *
 * A device can support WebGPU for one algorithm and not another, so
 * resolution happens per class, not once globally for the whole module.
 * This follows the same pattern used for BlurStrategy/ETFComputer.
 *
 * If a backend fails mid-session (driver crash, lost context), each
 * instance demotes itself to the next supported candidate once and
 * retries the call that failed; that shared retry/demote machinery lives
 * in `ResilientPreprocessor`, not duplicated per filter.
 */
function pickCandidates(candidates, options) {
    if (!options?.forceCPU)
        return candidates;
    return [candidates[candidates.length - 1]];
}
/**
 * Edge-preserving smoothing filter. Resolves the best supported backend
 * at creation time; falls back once if that backend fails later.
 */
class BilateralFilter extends ResilientPreprocessor {
    // Ordered best-to-worst. `satisfies` (not `implements`) catches a
    // backend missing isSupported() or the instance shape at this line.
    static candidates = [
        GPUBilateralFilter,
        BilateralFilterWebGL,
        BilateralFilter$1,
    ];
    constructor(resolved, config) {
        super(BilateralFilter.candidates, resolved, config);
    }
    static async create(config = {}, options) {
        const resolved = await ResilientPreprocessor.resolve(pickCandidates(BilateralFilter.candidates, options), config);
        return new BilateralFilter(resolved, config);
    }
}
/**
 * Median filter for salt-and-pepper noise removal.
 */
class MedianFilter extends ResilientPreprocessor {
    static candidates = [
        GPUMedianFilter,
        MedianFilterWebGL,
        MedianFilter$1,
    ];
    constructor(resolved, config) {
        super(MedianFilter.candidates, resolved, config);
    }
    static async create(config = {}, options) {
        const resolved = await ResilientPreprocessor.resolve(pickCandidates(MedianFilter.candidates, options), config);
        return new MedianFilter(resolved, config);
    }
}
/**
 * Kuwahara filter for a painterly, stylized effect.
 */
class KuwaharaFilter extends ResilientPreprocessor {
    static candidates = [
        GPUKuwaharaFilter,
        KuwaharaFilterWebGL,
        KuwaharaFilter$1,
    ];
    constructor(resolved, config) {
        super(KuwaharaFilter.candidates, resolved, config);
    }
    static async create(config = {}, options) {
        const resolved = await ResilientPreprocessor.resolve(pickCandidates(KuwaharaFilter.candidates, options), config);
        return new KuwaharaFilter(resolved, config);
    }
}
/**
 * Separable Gaussian blur.
 */
class GaussianBlur extends ResilientPreprocessor {
    static candidates = [
        GPUGaussianBlur,
        GaussianBlurWebGL,
        GaussianBlur$1,
    ];
    constructor(resolved, sigma) {
        super(GaussianBlur.candidates, resolved, sigma);
    }
    static async create(sigma = 1.0, options) {
        const resolved = await ResilientPreprocessor.resolve(pickCandidates(GaussianBlur.candidates, options), sigma);
        return new GaussianBlur(resolved, sigma);
    }
}
function adaptContrastCtor(Ctor) {
    const Adapted = class {
        static isSupported = Ctor.isSupported;
        static getUnsupportedReason = Ctor.getUnsupportedReason;
        constructor(config) {
            return new Ctor(config.blackPoint, config.whitePoint);
        }
    };
    return Adapted;
}
class ContrastEnhancer extends ResilientPreprocessor {
    static candidates = [
        adaptContrastCtor(GPUContrastEnhancer),
        adaptContrastCtor(ContrastEnhancerWebGL),
        adaptContrastCtor(ContrastEnhancer$1),
    ];
    constructor(resolved, config) {
        super(ContrastEnhancer.candidates, resolved, config);
    }
    static async create(blackPoint = 0.01, whitePoint = 0.99, options) {
        const config = { blackPoint, whitePoint };
        const resolved = await ResilientPreprocessor.resolve(pickCandidates(ContrastEnhancer.candidates, options), config);
        return new ContrastEnhancer(resolved, config);
    }
}
/**
 * Posterize/quantize intensity levels.
 */
class Quantizer extends ResilientPreprocessor {
    static candidates = [
        GPUQuantizer,
        QuantizerWebGL,
        Quantizer$1,
    ];
    constructor(resolved, levels) {
        super(Quantizer.candidates, resolved, levels);
    }
    static async create(levels = 8, options) {
        const resolved = await ResilientPreprocessor.resolve(pickCandidates(Quantizer.candidates, options), levels);
        return new Quantizer(resolved, levels);
    }
}
const PreprocessingPresets = {
    /**
     * Light preprocessing - minimal smoothing
     * Good for: Clean studio photos, illustrations
     */
    light: async (input) => {
        const filter = await BilateralFilter.create({ sigmaSpatial: 2, sigmaRange: 0.08 });
        try {
            return await filter.process(input);
        }
        finally {
            filter.dispose();
        }
    },
    /**
     * Standard preprocessing - balanced smoothing
     * Good for: Most outdoor photos, portraits
     */
    standard: async (input) => {
        const filter = await BilateralFilter.create({ sigmaSpatial: 4, sigmaRange: 0.1 });
        try {
            return await filter.process(input);
        }
        finally {
            filter.dispose();
        }
    },
    /**
     * Heavy preprocessing - aggressive noise removal
     * Good for: Very textured images (grass, foliage, fabric)
     */
    heavy: async (input) => {
        const first = await BilateralFilter.create({ sigmaSpatial: 5, sigmaRange: 0.12 });
        const second = await BilateralFilter.create({ sigmaSpatial: 3, sigmaRange: 0.1 });
        try {
            return await second.process(await first.process(input));
        }
        finally {
            first.dispose();
            second.dispose();
        }
    },
    /**
     * Artistic preprocessing - painterly smoothing
     * Good for: Stylized/artistic output
     */
    artistic: async (input) => {
        const kuwahara = await KuwaharaFilter.create({ radius: 4 });
        const bilateral = await BilateralFilter.create({ sigmaSpatial: 2, sigmaRange: 0.08 });
        try {
            return await bilateral.process(await kuwahara.process(input));
        }
        finally {
            kuwahara.dispose();
            bilateral.dispose();
        }
    },
    /**
     * Photo preprocessing - for photos with grass/nature
     * Good for: Landscape, outdoor scenes
     */
    nature: async (input) => {
        const first = await BilateralFilter.create({ sigmaSpatial: 6, sigmaRange: 0.15 });
        const second = await BilateralFilter.create({ sigmaSpatial: 3, sigmaRange: 0.08 });
        try {
            return await second.process(await first.process(input));
        }
        finally {
            first.dispose();
            second.dispose();
        }
    },
};
class PreprocessingPipeline {
    options;
    operations = [];
    constructor(options) {
        this.options = options;
    }
    async bilateral(config) {
        this.operations.push(await BilateralFilter.create(config, this.options));
        return this;
    }
    async median(config) {
        this.operations.push(await MedianFilter.create(config, this.options));
        return this;
    }
    async kuwahara(config) {
        this.operations.push(await KuwaharaFilter.create(config, this.options));
        return this;
    }
    async gaussian(sigma) {
        this.operations.push(await GaussianBlur.create(sigma, this.options));
        return this;
    }
    async contrast(blackPoint, whitePoint) {
        this.operations.push(await ContrastEnhancer.create(blackPoint, whitePoint, this.options));
        return this;
    }
    async quantize(levels) {
        this.operations.push(await Quantizer.create(levels, this.options));
        return this;
    }
    /**
     * Add an arbitrary custom preprocessing strategy to the pipeline.
     * Bring your own backend selection if needed.
     */
    use(preprocessor) {
        this.operations.push(preprocessor);
        return this;
    }
    async apply(input) {
        let result = input;
        for (const op of this.operations) {
            result = await op.process(result);
            op.dispose();
        }
        return result;
    }
    /** Disposes every staged operation's resources and clears the pipeline. */
    clear() {
        for (const op of this.operations)
            op.dispose();
        this.operations = [];
        return this;
    }
}

var index$1 = /*#__PURE__*/Object.freeze({
    __proto__: null,
    BilateralFilter: BilateralFilter,
    ContrastEnhancer: ContrastEnhancer,
    GaussianBlur: GaussianBlur,
    KuwaharaFilter: KuwaharaFilter,
    LocalVariancePreprocessor: LocalVariancePreprocessor,
    MedianFilter: MedianFilter,
    PreprocessingPipeline: PreprocessingPipeline,
    PreprocessingPresets: PreprocessingPresets,
    Quantizer: Quantizer,
    disposeWebGL: disposeWebGL,
    disposeWebGPU: disposeWebGPU,
    isWebGLAvailable: isWebGLAvailable,
    parameterEstimation: index$2,
    webgl: webgl
});

const DEFAULT_AA_CONFIG = {
    sigma: 1.0,
    stepSize: 0.5,
};
/**
 * Anti-Aliasing Strategy
 *
 * Applies line integral convolution along the edge tangent flow
 * to produce image-coherent and visually pleasing anti-aliasing.
 *
 * @example
 * ```typescript
 * const fdog = new FDoG({ ... });
 * const result = await fdog.processDetailed(input);
 *
 * const aa = new AntiAliasingStrategy();
 * const smoothed = await aa.apply({
 *   image: result.result,
 *   etf: result.etf
 * }, { sigma: 1.5 });
 * ```
 */
class AntiAliasingStrategy {
    config;
    constructor(config = {}) {
        this.config = { ...DEFAULT_AA_CONFIG, ...config };
    }
    async apply(input, configOverride) {
        const cfg = { ...this.config, ...configOverride };
        const { image, etf } = input;
        if (cfg.sigma <= 0) {
            return { data: new Float32Array(image.data), width: image.width, height: image.height };
        }
        const flowBlur = await FlowGuidedBlur.create(etf, { stepSize: cfg.stepSize });
        const result = flowBlur.blur(image, cfg.sigma);
        flowBlur.dispose();
        return result;
    }
    /**
     * Create anti-aliasing with preset intensity
     */
    static withPreset(preset) {
        const presets = {
            subtle: { sigma: 0.5, stepSize: 0.5 },
            standard: { sigma: 1.0, stepSize: 0.5 },
            stylistic: { sigma: 3.0, stepSize: 0.5 },
        };
        return new AntiAliasingStrategy(presets[preset]);
    }
}

/**
 * Color Retention Extension - Extensible Architecture
 *
 * Provides a composable, hook-based system for combining stylized XDoG/FDoG
 * output with original colors. Developers can inject custom logic at every
 * stage of the pipeline.
 *
 * Pipeline stages:
 * 1. Mask Transform: Modify the stylized mask before blending
 * 2. Color Transform: Pre-process the original color
 * 3. Blend Function: Combine mask and color (the core operation)
 * 4. Post-Process: Final adjustments to the output
 *
 * Based on Section 5.2 of the XDoG paper.
 */
// =============================================================================
// Main Strategy Class
// =============================================================================
/**
 * Extensible Color Retention Strategy
 *
 * A fully customizable pipeline for combining stylized edges with colors.
 * Every stage can be overridden with custom functions.
 *
 * @example Basic usage with preset
 * ```typescript
 * const strategy = ColorRetentionStrategy.preset('coloredEdges');
 * const result = await strategy.apply({ stylized, originalColor });
 * ```
 *
 * @example Custom blend function
 * ```typescript
 * const strategy = new ColorRetentionStrategy({
 *   blend: (color, mask) => {
 *     // Custom logic here
 *     return [color[0] * mask, color[1] * mask, color[2] * mask];
 *   }
 * });
 * ```
 *
 * @example Full pipeline customization
 * ```typescript
 * const strategy = new ColorRetentionStrategy({
 *   maskTransform: (mask) => Math.pow(mask, 0.8), // Gamma adjust
 *   colorTransform: (color, mask) => boostSaturation(color, 1.2),
 *   blend: BlendFunctions.multiply,
 *   postProcess: (color, orig, mask, ctx) => addVignette(color, ctx),
 * });
 * ```
 *
 * @example Chaining multiple transforms
 * ```typescript
 * const strategy = new ColorRetentionStrategy({
 *   maskTransformChain: [
 *     MaskTransforms.gamma(0.8),
 *     MaskTransforms.threshold(0.1, 0.9),
 *   ],
 *   colorTransformChain: [
 *     ColorTransforms.saturation(1.2),
 *     ColorTransforms.brightness(0.1),
 *   ],
 *   blend: BlendFunctions.coloredEdges(),
 * });
 * ```
 */
class ColorRetentionStrategy {
    config;
    constructor(config) {
        this.config = config;
    }
    async apply(input, configOverride) {
        const cfg = { ...this.config, ...configOverride };
        const { stylized, originalColor } = input;
        const { width, height } = stylized;
        const size = width * height;
        // Shared state for hooks
        const state = new Map();
        // Run global pre-process
        if (cfg.preProcess) {
            cfg.preProcess(stylized, originalColor, state);
        }
        // Build transform chains
        const maskTransforms = this.buildMaskTransformChain(cfg);
        const colorTransforms = this.buildColorTransformChain(cfg);
        const postProcesses = this.buildPostProcessChain(cfg);
        // Create output
        const output = {
            r: new Float32Array(size),
            g: new Float32Array(size),
            b: new Float32Array(size),
            width,
            height,
        };
        // Process each pixel
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = y * width + x;
                // Build pixel context
                const ctx = this.createPixelContext(x, y, index, width, height, stylized, originalColor, state);
                // Get initial values
                let mask = stylized.data[index];
                let color = [
                    originalColor.r[index],
                    originalColor.g[index],
                    originalColor.b[index],
                ];
                const origColor = [...color];
                // Apply mask transforms
                for (const transform of maskTransforms) {
                    mask = transform(mask, ctx);
                }
                // Apply color transforms
                for (const transform of colorTransforms) {
                    color = transform(color, mask, ctx);
                }
                // Apply blend
                let result = cfg.blend(color, mask, ctx);
                // Apply post-processes
                for (const postProcess of postProcesses) {
                    result = postProcess(result, origColor, mask, ctx);
                }
                // Write output
                output.r[index] = clamp(result[0]);
                output.g[index] = clamp(result[1]);
                output.b[index] = clamp(result[2]);
            }
        }
        // Run global post-process
        if (cfg.globalPostProcess) {
            return cfg.globalPostProcess(output, state);
        }
        return output;
    }
    buildMaskTransformChain(cfg) {
        const chain = [];
        if (cfg.maskTransform)
            chain.push(cfg.maskTransform);
        if (cfg.maskTransformChain)
            chain.push(...cfg.maskTransformChain);
        return chain;
    }
    buildColorTransformChain(cfg) {
        const chain = [];
        if (cfg.colorTransform)
            chain.push(cfg.colorTransform);
        if (cfg.colorTransformChain)
            chain.push(...cfg.colorTransformChain);
        return chain;
    }
    buildPostProcessChain(cfg) {
        const chain = [];
        if (cfg.postProcess)
            chain.push(cfg.postProcess);
        if (cfg.postProcessChain)
            chain.push(...cfg.postProcessChain);
        return chain;
    }
    createPixelContext(x, y, index, width, height, stylized, originalColor, state) {
        return {
            x,
            y,
            index,
            width,
            height,
            u: x / (width - 1),
            v: y / (height - 1),
            sampleColor: (dx, dy) => {
                const sx = clampInt(x + dx, 0, width - 1);
                const sy = clampInt(y + dy, 0, height - 1);
                const si = sy * width + sx;
                return [originalColor.r[si], originalColor.g[si], originalColor.b[si]];
            },
            sampleMask: (dx, dy) => {
                const sx = clampInt(x + dx, 0, width - 1);
                const sy = clampInt(y + dy, 0, height - 1);
                return stylized.data[sy * width + sx];
            },
            getState: (key) => state.get(key),
            setState: (key, value) => { state.set(key, value); },
        };
    }
    // ===========================================================================
    // Static Factory Methods
    // ===========================================================================
    /**
     * Create a strategy from a preset
     */
    static preset(name) {
        return new ColorRetentionStrategy(Presets[name]);
    }
    /**
     * Create a strategy with just a blend function
     */
    static withBlend(blend) {
        return new ColorRetentionStrategy({ blend });
    }
    /**
     * Builder pattern for constructing complex pipelines
     */
    static builder() {
        return new ColorRetentionBuilder();
    }
}
// =============================================================================
// Builder Pattern
// =============================================================================
/**
 * Fluent builder for constructing color retention pipelines
 *
 * @example
 * ```typescript
 * const strategy = ColorRetentionStrategy.builder()
 *   .maskTransform(MaskTransforms.gamma(0.8))
 *   .maskTransform(MaskTransforms.clamp(0.05, 0.95))
 *   .colorTransform(ColorTransforms.saturation(1.2))
 *   .blend(BlendFunctions.multiply)
 *   .postProcess(PostProcessors.vignette(0.3))
 *   .build();
 * ```
 */
class ColorRetentionBuilder {
    maskTransforms = [];
    colorTransforms = [];
    postProcesses = [];
    blendFn;
    preProcessHook;
    globalPostProcessHook;
    maskTransform(fn) {
        this.maskTransforms.push(fn);
        return this;
    }
    colorTransform(fn) {
        this.colorTransforms.push(fn);
        return this;
    }
    blend(fn) {
        this.blendFn = fn;
        return this;
    }
    postProcess(fn) {
        this.postProcesses.push(fn);
        return this;
    }
    preProcess(fn) {
        this.preProcessHook = fn;
        return this;
    }
    globalPostProcess(fn) {
        this.globalPostProcessHook = fn;
        return this;
    }
    build() {
        if (!this.blendFn) {
            throw new Error('Blend function is required. Call .blend() before .build()');
        }
        return new ColorRetentionStrategy({
            blend: this.blendFn,
            maskTransformChain: this.maskTransforms.length > 0 ? this.maskTransforms : undefined,
            colorTransformChain: this.colorTransforms.length > 0 ? this.colorTransforms : undefined,
            postProcessChain: this.postProcesses.length > 0 ? this.postProcesses : undefined,
            preProcess: this.preProcessHook,
            globalPostProcess: this.globalPostProcessHook,
        });
    }
}
// =============================================================================
// Built-in Blend Functions
// =============================================================================
/**
 * Collection of common blend functions
 */
const BlendFunctions$1 = {
    /**
     * Simple multiply: color * mask
     * White mask = full color, black mask = black
     */
    multiply: ((color, mask) => [
        color[0] * mask,
        color[1] * mask,
        color[2] * mask,
    ]),
    /**
     * Screen blend: 1 - (1-color) * (1-mask)
     * Creates lighter results
     */
    screen: ((color, mask) => [
        1 - (1 - color[0]) * (1 - mask),
        1 - (1 - color[1]) * (1 - mask),
        1 - (1 - color[2]) * (1 - mask),
    ]),
    /**
     * Overlay blend: combines multiply and screen
     */
    overlay: ((color, mask) => {
        const overlay = (c, m) => c < 0.5 ? 2 * c * m : 1 - 2 * (1 - c) * (1 - m);
        return [overlay(color[0], mask), overlay(color[1], mask), overlay(color[2], mask)];
    }),
    /**
     * Soft light blend: gentler than overlay
     */
    softLight: ((color, mask) => {
        const soft = (c, m) => {
            if (m < 0.5) {
                return c - (1 - 2 * m) * c * (1 - c);
            }
            const d = c <= 0.25 ? ((16 * c - 12) * c + 4) * c : Math.sqrt(c);
            return c + (2 * m - 1) * (d - c);
        };
        return [soft(color[0], mask), soft(color[1], mask), soft(color[2], mask)];
    }),
    /**
     * Colored edges: black lines on colored background
     * Most common use case for line art + color
     */
    coloredEdges: (edgeStrength = 1.0) => {
        const edgeBrightness = 1 - edgeStrength;
        return (color, mask) => [
            color[0] * mask + edgeBrightness * (1 - mask),
            color[1] * mask + edgeBrightness * (1 - mask),
            color[2] * mask + edgeBrightness * (1 - mask),
        ];
    },
    /**
     * Tinted lines: edges take on underlying color
     */
    tintedLines: (darkness = 0.8) => {
        const minBrightness = 1 - darkness;
        return (color, mask) => {
            const edgeR = color[0] * minBrightness;
            const edgeG = color[1] * minBrightness;
            const edgeB = color[2] * minBrightness;
            return [
                edgeR + (color[0] - edgeR) * mask,
                edgeG + (color[1] - edgeG) * mask,
                edgeB + (color[2] - edgeB) * mask,
            ];
        };
    },
    /**
     * Luminosity replacement in HSL space
     */
    luminosity: ((color, mask) => {
        const [h, s] = rgbToHsl(...color);
        return hslToRgb(h, s, mask);
    }),
    /**
     * Linear interpolation between color and grayscale edge
     */
    lerp: (edgeColor = [0, 0, 0]) => {
        return (color, mask) => [
            edgeColor[0] + (color[0] - edgeColor[0]) * mask,
            edgeColor[1] + (color[1] - edgeColor[1]) * mask,
            edgeColor[2] + (color[2] - edgeColor[2]) * mask,
        ];
    },
    /**
     * Preserve hue and saturation, replace value (HSV)
     */
    valueReplace: ((color, mask) => {
        const [h, s] = rgbToHsv(...color);
        return hsvToRgb(h, s, mask);
    }),
};
// =============================================================================
// Built-in Mask Transforms
// =============================================================================
/**
 * Collection of mask transformation functions
 */
const MaskTransforms = {
    /**
     * Gamma correction for mask
     */
    gamma: (gamma) => (mask) => Math.pow(mask, gamma),
    /**
     * Clamp mask to range
     */
    clamp: (min, max) => (mask) => Math.max(min, Math.min(max, mask)),
    /**
     * Remap mask from [inMin, inMax] to [outMin, outMax]
     */
    remap: (inMin, inMax, outMin = 0, outMax = 1) => (mask) => outMin + (outMax - outMin) * ((mask - inMin) / (inMax - inMin)),
    /**
     * Invert the mask
     */
    invert: () => (mask) => 1 - mask,
    /**
     * Apply contrast adjustment
     */
    contrast: (amount) => (mask) => clamp((mask - 0.5) * amount + 0.5),
    /**
     * Threshold with soft edges
     */
    softThreshold: (threshold, softness = 0.1) => (mask) => clamp((mask - threshold + softness) / (2 * softness)),
    /**
     * Hard threshold (binary)
     */
    threshold: (threshold) => (mask) => mask > threshold ? 1 : 0,
    /**
     * Quantize to N levels
     */
    quantize: (levels) => (mask) => Math.round(mask * (levels - 1)) / (levels - 1),
    /**
     * Morphological dilation (expand dark/edge regions)
     */
    dilate: (radius = 1) => (mask, ctx) => {
        let min = mask;
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (dx * dx + dy * dy <= radius * radius) {
                    min = Math.min(min, ctx.sampleMask(dx, dy));
                }
            }
        }
        return min;
    },
    /**
     * Morphological erosion (shrink dark/edge regions)
     */
    erode: (radius = 1) => (mask, ctx) => {
        let max = mask;
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (dx * dx + dy * dy <= radius * radius) {
                    max = Math.max(max, ctx.sampleMask(dx, dy));
                }
            }
        }
        return max;
    },
    /**
     * Gaussian blur approximation
     */
    blur: (radius = 1) => (_mask, ctx) => {
        let sum = 0;
        let weight = 0;
        const sigma = radius / 2;
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const w = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
                sum += ctx.sampleMask(dx, dy) * w;
                weight += w;
            }
        }
        return sum / weight;
    },
    /**
     * Add noise to mask
     */
    noise: (amount, seed = 12345) => {
        // Simple deterministic hash for reproducibility
        const hash = (x, y) => {
            let h = seed + x * 374761393 + y * 668265263;
            h = (h ^ (h >> 13)) * 1274126177;
            return ((h ^ (h >> 16)) & 0xFFFF) / 0xFFFF;
        };
        return (mask, ctx) => clamp(mask + (hash(ctx.x, ctx.y) - 0.5) * amount * 2);
    },
};
// =============================================================================
// Built-in Color Transforms
// =============================================================================
/**
 * Collection of color transformation functions
 */
const ColorTransforms = {
    /**
     * Adjust saturation
     */
    saturation: (factor) => (color) => {
        const [h, s, l] = rgbToHsl(...color);
        return hslToRgb(h, clamp(s * factor), l);
    },
    /**
     * Adjust brightness
     */
    brightness: (amount) => (color) => {
        if (amount > 0) {
            return [
                color[0] + (1 - color[0]) * amount,
                color[1] + (1 - color[1]) * amount,
                color[2] + (1 - color[2]) * amount,
            ];
        }
        return [
            color[0] * (1 + amount),
            color[1] * (1 + amount),
            color[2] * (1 + amount),
        ];
    },
    /**
     * Adjust contrast
     */
    contrast: (amount) => (color) => [
        clamp((color[0] - 0.5) * amount + 0.5),
        clamp((color[1] - 0.5) * amount + 0.5),
        clamp((color[2] - 0.5) * amount + 0.5),
    ],
    /**
     * Shift hue
     */
    hueShift: (degrees) => (color) => {
        const [h, s, l] = rgbToHsl(...color);
        return hslToRgb((h + degrees / 360 + 1) % 1, s, l);
    },
    /**
     * Desaturate based on mask (less saturation in edge areas)
     */
    maskBasedDesaturate: (factor = 0.5) => (color, mask) => {
        const [h, s, l] = rgbToHsl(...color);
        const newS = s * (mask + (1 - mask) * (1 - factor));
        return hslToRgb(h, newS, l);
    },
    /**
     * Apply a color matrix transformation
     */
    colorMatrix: (matrix) => (color) => {
        const [r, g, b] = color;
        return [
            clamp(matrix[0][0] * r + matrix[0][1] * g + matrix[0][2] * b + (matrix[0][3] || 0)),
            clamp(matrix[1][0] * r + matrix[1][1] * g + matrix[1][2] * b + (matrix[1][3] || 0)),
            clamp(matrix[2][0] * r + matrix[2][1] * g + matrix[2][2] * b + (matrix[2][3] || 0)),
        ];
    },
    /**
     * Sepia tone
     */
    sepia: (intensity = 1.0) => {
        const matrix = [
            [0.393, 0.769, 0.189],
            [0.349, 0.686, 0.168],
            [0.272, 0.534, 0.131],
        ];
        return (color) => {
            const [r, g, b] = color;
            const sepiaR = clamp(matrix[0][0] * r + matrix[0][1] * g + matrix[0][2] * b);
            const sepiaG = clamp(matrix[1][0] * r + matrix[1][1] * g + matrix[1][2] * b);
            const sepiaB = clamp(matrix[2][0] * r + matrix[2][1] * g + matrix[2][2] * b);
            return [
                r + (sepiaR - r) * intensity,
                g + (sepiaG - g) * intensity,
                b + (sepiaB - b) * intensity,
            ];
        };
    },
    /**
     * Warm/cool temperature adjustment
     */
    temperature: (warmth) => (color) => {
        // Positive = warmer (more red/yellow), negative = cooler (more blue)
        return [
            clamp(color[0] + warmth * 0.1),
            color[1],
            clamp(color[2] - warmth * 0.1),
        ];
    },
};
// =============================================================================
// Built-in Post Processors
// =============================================================================
/**
 * Collection of post-processing functions
 */
const PostProcessors = {
    /**
     * Add vignette effect
     */
    vignette: (strength = 0.3, radius = 0.7) => (color, _orig, _mask, ctx) => {
        const dist = Math.sqrt((ctx.u - 0.5) ** 2 + (ctx.v - 0.5) ** 2) / 0.707;
        const vignette = 1 - Math.max(0, (dist - radius) / (1 - radius)) * strength;
        return [color[0] * vignette, color[1] * vignette, color[2] * vignette];
    },
    /**
     * Add film grain
     */
    grain: (amount = 0.05, seed = 54321) => {
        const hash = (x, y) => {
            let h = seed + x * 374761393 + y * 668265263;
            h = (h ^ (h >> 13)) * 1274126177;
            return ((h ^ (h >> 16)) & 0xFFFF) / 0xFFFF;
        };
        return (color, _orig, _mask, ctx) => {
            const noise = (hash(ctx.x, ctx.y) - 0.5) * amount * 2;
            return [
                clamp(color[0] + noise),
                clamp(color[1] + noise),
                clamp(color[2] + noise),
            ];
        };
    },
    /**
     * Blend with original color
     */
    blendOriginal: (amount) => (color, orig) => [
        color[0] + (orig[0] - color[0]) * amount,
        color[1] + (orig[1] - color[1]) * amount,
        color[2] + (orig[2] - color[2]) * amount,
    ],
    /**
     * Clamp output to valid range
     */
    clampOutput: () => (color) => [clamp(color[0]), clamp(color[1]), clamp(color[2])],
    /**
     * Posterize (reduce color levels)
     */
    posterize: (levels) => (color) => [
        Math.round(color[0] * (levels - 1)) / (levels - 1),
        Math.round(color[1] * (levels - 1)) / (levels - 1),
        Math.round(color[2] * (levels - 1)) / (levels - 1),
    ],
    /**
     * Edge-aware sharpening
     */
    sharpenEdges: (amount = 0.5) => (color, orig, mask) => {
        // Sharpen more in edge areas (where mask is darker)
        const sharpness = amount * (1 - mask);
        return [
            clamp(color[0] + (color[0] - orig[0]) * sharpness),
            clamp(color[1] + (color[1] - orig[1]) * sharpness),
            clamp(color[2] + (color[2] - orig[2]) * sharpness),
        ];
    },
};
// =============================================================================
// Presets
// =============================================================================
/**
 * Pre-built configurations for common use cases
 */
const Presets = {
    /**
     * Standard: black lines on full-color background
     */
    coloredEdges: {
        blend: BlendFunctions$1.coloredEdges(1.0),
    },
    /**
     * Painterly: soft, integrated tinted edges
     */
    painterly: {
        maskTransformChain: [MaskTransforms.gamma(0.85)],
        colorTransformChain: [ColorTransforms.saturation(1.1)],
        blend: BlendFunctions$1.tintedLines(0.7),
        postProcessChain: [PostProcessors.vignette(0.15)],
    },
    /**
     * Vintage: muted colors with soft grain
     */
    vintage: {
        maskTransformChain: [MaskTransforms.contrast(0.9)],
        colorTransformChain: [
            ColorTransforms.saturation(0.7),
            ColorTransforms.sepia(0.3),
        ],
        blend: BlendFunctions$1.softLight,
        postProcessChain: [PostProcessors.grain(0.03)],
    },
    /**
     * Bold: high contrast with boosted saturation
     */
    bold: {
        maskTransformChain: [MaskTransforms.contrast(1.3)],
        colorTransformChain: [
            ColorTransforms.saturation(1.3),
            ColorTransforms.contrast(1.1),
        ],
        blend: BlendFunctions$1.coloredEdges(1.0),
    },
    /**
     * Sketch: pure line art with optional paper texture
     */
    sketch: {
        maskTransformChain: [
            MaskTransforms.threshold(0.5),
        ],
        blend: BlendFunctions$1.multiply,
    },
    /**
     * Watercolor: soft edges with color bleeding effect
     */
    watercolor: {
        maskTransformChain: [
            MaskTransforms.blur(2),
            MaskTransforms.gamma(0.7),
        ],
        colorTransformChain: [
            ColorTransforms.saturation(1.2),
        ],
        blend: BlendFunctions$1.tintedLines(0.5),
        postProcessChain: [PostProcessors.vignette(0.2)],
    },
};
// =============================================================================
// Helper Functions
// =============================================================================
function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
}
function clampInt(value, min, max) {
    return Math.max(min, Math.min(max, Math.round(value)));
}
// HSL conversion
function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min)
        return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    switch (max) {
        case r:
            h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
            break;
        case g:
            h = ((b - r) / d + 2) / 6;
            break;
        default:
            h = ((r - g) / d + 4) / 6;
            break;
    }
    return [h, s, l];
}
function hslToRgb(h, s, l) {
    if (s === 0)
        return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (t) => {
        if (t < 0)
            t += 1;
        if (t > 1)
            t -= 1;
        if (t < 1 / 6)
            return p + (q - p) * 6 * t;
        if (t < 1 / 2)
            return q;
        if (t < 2 / 3)
            return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [hue2rgb(h + 1 / 3), hue2rgb(h), hue2rgb(h - 1 / 3)];
}
// HSV conversion
function rgbToHsv(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const v = max;
    const d = max - min;
    const s = max === 0 ? 0 : d / max;
    if (max === min)
        return [0, s, v];
    let h;
    switch (max) {
        case r:
            h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
            break;
        case g:
            h = ((b - r) / d + 2) / 6;
            break;
        default:
            h = ((r - g) / d + 4) / 6;
            break;
    }
    return [h, s, v];
}
function hsvToRgb(h, s, v) {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0: return [v, t, p];
        case 1: return [q, v, p];
        case 2: return [p, v, t];
        case 3: return [p, q, v];
        case 4: return [t, p, v];
        default: return [v, p, q];
    }
}
// =============================================================================
// Utility Functions for Image Conversion
// =============================================================================
function imageDataToRGB$1(imageData) {
    const { width, height } = imageData;
    const size = width * height;
    const rgb = {
        r: new Float32Array(size),
        g: new Float32Array(size),
        b: new Float32Array(size),
        width,
        height,
    };
    for (let i = 0; i < size; i++) {
        rgb.r[i] = imageData.data[i * 4] / 255;
        rgb.g[i] = imageData.data[i * 4 + 1] / 255;
        rgb.b[i] = imageData.data[i * 4 + 2] / 255;
    }
    return rgb;
}
function rgbToImageData$1(rgb) {
    const { width, height } = rgb;
    const imageData = new ImageData(width, height);
    const size = width * height;
    for (let i = 0; i < size; i++) {
        imageData.data[i * 4] = Math.round(clamp(rgb.r[i]) * 255);
        imageData.data[i * 4 + 1] = Math.round(clamp(rgb.g[i]) * 255);
        imageData.data[i * 4 + 2] = Math.round(clamp(rgb.b[i]) * 255);
        imageData.data[i * 4 + 3] = 255;
    }
    return imageData;
}

var colorRetention = /*#__PURE__*/Object.freeze({
    __proto__: null,
    BlendFunctions: BlendFunctions$1,
    ColorRetentionBuilder: ColorRetentionBuilder,
    ColorRetentionStrategy: ColorRetentionStrategy,
    ColorTransforms: ColorTransforms,
    MaskTransforms: MaskTransforms,
    PostProcessors: PostProcessors,
    Presets: Presets,
    imageDataToRGB: imageDataToRGB$1,
    rgbToImageData: rgbToImageData$1
});

const DEFAULT_HATCHING_CONFIG = {
    thresholdLevels: [0.3, 0.5, 0.7],
    p: 20,
    phi: 10, // Lowered from 100 for smoother transitions
    cumulative: true,
};
/**
 * Hatching Strategy
 *
 * Creates tonal art maps by computing multiple threshold levels from a
 * sharpened XDoG/FDoG image and using them as masks for hatching textures.
 *
 * The key insight from tonal art maps is that darker tones are achieved by
 * ACCUMULATING hatching layers - dark areas have all hatching layers active,
 * while light areas have none.
 *
 * @example
 * ```typescript
 * const xdog = new XDoG({ p: 20 });
 * const { sharpened } = await xdog.processDetailed(input);
 *
 * const hatching = new HatchingStrategy({
 *   thresholdLevels: [0.25, 0.5, 0.75],
 *   textures: [darkHatch, medHatch, lightHatch, white],
 * });
 * const result = await hatching.apply({ sharpened, original: input });
 * ```
 */
class HatchingStrategy {
    config;
    constructor(config = {}) {
        this.config = { ...DEFAULT_HATCHING_CONFIG, ...config };
    }
    /**
     * Generate cumulative threshold masks for tonal art maps
     *
     * For tonal art maps, we generate masks where:
     * - Mask 0 (darkest hatching): active where input < levels[0]
     * - Mask 1: active where input < levels[1]
     * - Mask N (lightest): active everywhere (or where input < 1.0)
     *
     * Each darker mask is a SUBSET of the lighter masks, creating the
     * cumulative effect where dark areas have more hatching.
     */
    generateMasks(sharpened, configOverride) {
        const cfg = { ...this.config, ...configOverride };
        const { width, height } = sharpened;
        const levels = [...cfg.thresholdLevels].sort((a, b) => a - b);
        const masks = [];
        if (cfg.cumulative) {
            // Cumulative masks for tonal art maps
            // Each mask covers "below this threshold"
            // Darkest areas activate ALL masks, lightest activate NONE
            for (let i = 0; i < levels.length; i++) {
                const mask = createChannelImage$1(width, height);
                const threshold = levels[i];
                for (let j = 0; j < width * height; j++) {
                    const val = sharpened.data[j];
                    // Soft threshold with smooth falloff
                    // Active (1.0) when val < threshold, fading as val approaches threshold
                    const diff = threshold - val;
                    if (diff > 0) {
                        // Below threshold: fully active with soft edge
                        mask.data[j] = Math.min(1.0, diff * cfg.phi + 0.5);
                    }
                    else {
                        // Above threshold: fade out
                        mask.data[j] = Math.max(0, 0.5 + diff * cfg.phi);
                    }
                }
                masks.push(mask);
            }
            // Add a final "base" mask that's always slightly active for paper texture
            const baseMask = createChannelImage$1(width, height);
            for (let j = 0; j < width * height; j++) {
                baseMask.data[j] = 0.0; // No hatching in lightest areas
            }
            masks.push(baseMask);
        }
        else {
            // Non-cumulative: independent bands (original behavior, but fixed)
            for (let i = 0; i <= levels.length; i++) {
                const mask = createChannelImage$1(width, height);
                const lowerBound = i === 0 ? 0 : levels[i - 1];
                const upperBound = i === levels.length ? 1 : levels[i];
                const bandCenter = (lowerBound + upperBound) / 2;
                const bandWidth = upperBound - lowerBound;
                for (let j = 0; j < width * height; j++) {
                    const val = sharpened.data[j];
                    if (val >= lowerBound && val < upperBound) {
                        // Inside band: full intensity with soft edges
                        const distFromCenter = Math.abs(val - bandCenter);
                        const normalizedDist = distFromCenter / (bandWidth / 2);
                        mask.data[j] = 1.0 - normalizedDist * normalizedDist * 0.3; // Slight falloff at edges
                    }
                    else {
                        // Outside band: smooth falloff
                        const distFromBand = val < lowerBound ? lowerBound - val : val - upperBound;
                        mask.data[j] = Math.max(0, 1.0 - distFromBand * cfg.phi);
                    }
                }
                masks.push(mask);
            }
        }
        return masks;
    }
    async apply(input, configOverride) {
        const cfg = { ...this.config, ...configOverride };
        const { sharpened } = input;
        const { width, height } = sharpened;
        // Generate masks
        const masks = this.generateMasks(sharpened, cfg);
        const output = createChannelImage$1(width, height);
        if (!cfg.textures || cfg.textures.length === 0) {
            // Simple tonal bands without textures
            // Map input luminance to output with quantized bands
            const numBands = masks.length;
            for (let i = 0; i < width * height; i++) {
                if (cfg.cumulative) {
                    // Count how many masks are active at this pixel
                    let activeMasks = 0;
                    for (let b = 0; b < masks.length - 1; b++) {
                        activeMasks += masks[b].data[i];
                    }
                    // More active masks = darker output
                    output.data[i] = 1.0 - (activeMasks / (numBands - 1));
                }
                else {
                    // Weighted sum of band values
                    let value = 0;
                    for (let b = 0; b < numBands; b++) {
                        const bandValue = b / (numBands - 1); // 0 = black, 1 = white
                        value += masks[b].data[i] * bandValue;
                    }
                    output.data[i] = Math.min(1, value);
                }
            }
        }
        else {
            // Composite textures using masks (tonal art map approach)
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = y * width + x;
                    // Start with paper/white
                    let value = cfg.paperTexture ? getPixel(cfg.paperTexture, x, y) : 1.0;
                    if (cfg.cumulative) {
                        // Tonal art maps: darker areas accumulate more hatching
                        // Apply textures from lightest to darkest, darkening where masks are active
                        const numTextures = Math.min(masks.length, cfg.textures.length);
                        for (let b = numTextures - 1; b >= 0; b--) {
                            const maskVal = masks[b].data[idx];
                            if (maskVal > 0.01) {
                                const tex = cfg.textures[b];
                                const texVal = this.sampleTexture(tex, x, y, width, height);
                                // Darken by the texture where the mask is active
                                // texVal of 0.2 (dark line) should darken; 1.0 (white) no change
                                value = value * (1.0 - maskVal * (1.0 - texVal));
                            }
                        }
                    }
                    else {
                        // Independent bands: blend textures based on mask weights
                        let totalWeight = 0;
                        let weightedValue = 0;
                        for (let b = 0; b < Math.min(masks.length, cfg.textures.length); b++) {
                            const maskVal = masks[b].data[idx];
                            if (maskVal > 0.01) {
                                const tex = cfg.textures[b];
                                const texVal = this.sampleTexture(tex, x, y, width, height);
                                weightedValue += maskVal * texVal;
                                totalWeight += maskVal;
                            }
                        }
                        if (totalWeight > 0) {
                            value = weightedValue / totalWeight;
                        }
                    }
                    output.data[idx] = Math.max(0, Math.min(1, value));
                }
            }
        }
        return output;
    }
    /**
     * Sample a texture with tiling and rotation
     */
    sampleTexture(texture, x, y, imageWidth, imageHeight) {
        const { data, rotation } = texture;
        // Apply rotation around image center
        const cx = imageWidth / 2;
        const cy = imageHeight / 2;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const rx = (x - cx) * cos - (y - cy) * sin + cx;
        const ry = (x - cx) * sin + (y - cy) * cos + cy;
        // Tile the texture
        const tx = ((rx % data.width) + data.width) % data.width;
        const ty = ((ry % data.height) + data.height) % data.height;
        return getPixelBilinear(data, tx, ty);
    }
    /**
     * Generate a simple procedural hatching texture
     *
     * Creates parallel lines at the specified spacing and thickness.
     * The rotation parameter rotates the SAMPLING, not the line pattern itself.
     */
    static generateHatchTexture(width, height, spacing, thickness, rotation = 0) {
        const data = createChannelImage$1(width, height);
        // Create horizontal lines (rotation is applied during sampling)
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                // Simple horizontal stripe pattern
                const linePos = y % spacing;
                const isLine = linePos < thickness;
                // Add slight anti-aliasing at line edges
                let value;
                if (isLine) {
                    value = 0.15; // Dark line
                }
                else if (linePos === thickness) {
                    value = 0.5; // Edge transition
                }
                else {
                    value = 1.0; // White space
                }
                data.data[y * width + x] = value;
            }
        }
        return { data, rotation };
    }
    /**
     * Generate a cross-hatching texture (two overlapping line patterns)
     */
    static generateCrossHatchTexture(width, height, spacing, thickness, angle1 = 0, angle2 = Math.PI / 2) {
        const data = createChannelImage$1(width, height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                // First set of lines
                const pos1 = (x * Math.cos(angle1) + y * Math.sin(angle1)) % spacing;
                const isLine1 = pos1 >= 0 && pos1 < thickness;
                // Second set of lines (perpendicular or at angle)
                const pos2 = (x * Math.cos(angle2) + y * Math.sin(angle2)) % spacing;
                const isLine2 = pos2 >= 0 && pos2 < thickness;
                let value = 1.0;
                if (isLine1 && isLine2) {
                    value = 0.05; // Darkest at intersections
                }
                else if (isLine1 || isLine2) {
                    value = 0.2; // Single line
                }
                data.data[y * width + x] = value;
            }
        }
        return { data, rotation: 0 };
    }
}

/**
 * Natural Media Strategy
 *
 * Provides preset parameter configurations for pencil, pastel, charcoal,
 * and other natural media styles as described in Section 5.2.
 *
 * @example
 * ```typescript
 * const naturalMedia = new NaturalMediaStrategy({ style: 'pastel' });
 * const result = await naturalMedia.apply(input);
 * ```
 */
class NaturalMediaStrategy {
    config;
    /**
     * Style presets from Section 5.2 and Table A.1
     *
     * Note on epsilon values:
     * - epsilon is the threshold for white vs black transition (0-1 range)
     * - Values ABOVE epsilon become white, values BELOW follow soft threshold
     * - For natural media effects, we want lower epsilon values to preserve
     *   more tonal variation and avoid all-white output
     */
    static PRESETS = {
        /**
         * Pencil shading: High-frequency detail resembling graphite on paper
         * Uses small σ ≈ 0.4 and φ ≈ 0.01 for gradual tones
         */
        pencilShading: {
            sigma: 0.4,
            k: 1.6,
            p: 7,
            epsilon: 0.5,
            phi: 5.00,
            useFlow: false,
        },
        /**
         * Pastel: Intermediate edge width with flow turbulence
         * σe ≈ 2, minimal σc, large σm for turbulence
         *
         * Fixed: epsilon was 1.0 which caused all-white output.
         * With epsilon=1.0 and soft threshold (phi=0.01), all normalized
         * pixel values (0-1) fall at or below threshold, producing white.
         * Lowered to 0.75 to preserve tonal range while keeping light appearance.
         */
        pastel: {
            sigma: 2.0,
            k: 1.6,
            p: 40,
            epsilon: 0.75, // Fixed: was 1.0, causing all-white output
            phi: 5.00,
            sigmaC: 0.1,
            sigmaM: 20,
            sigmaA: 7.2,
            useFlow: true,
        },
        /**
         * Charcoal: Broad strokes from large spatial support
         * σe ≈ 7 for wide strokes
         *
         * Fixed: epsilon was 0.8 which with phi=0.01 was too high,
         * causing very washed-out or mostly white results.
         * Lowered to 0.6 for better tonal range in charcoal style.
         */
        charcoal: {
            sigma: 7.0,
            k: 1.6,
            p: 70,
            epsilon: 0.6, // Fixed: was 0.8, causing washed-out output
            phi: 5.00,
            sigmaC: 0.1,
            sigmaM: 20,
            sigmaA: 0.6,
            useFlow: true,
        },
        /**
         * Dry brush: Similar to pastel but with different anti-aliasing
         *
         * Fixed: epsilon was 0.9 which caused mostly white output.
         * Lowered to 0.7 for better stroke visibility.
         */
        dryBrush: {
            sigma: 3.0,
            k: 1.6,
            p: 50,
            epsilon: 0.7, // Fixed: was 0.9, causing mostly white output
            phi: 5.00,
            sigmaC: 0.1,
            sigmaM: 15,
            sigmaA: 2.0,
            useFlow: true,
        },
    };
    constructor(config = {}) {
        this.config = { style: 'pencilShading', ...config };
    }
    /**
     * Get the resolved configuration for the current style
     */
    getResolvedConfig() {
        const preset = NaturalMediaStrategy.PRESETS[this.config.style];
        return {
            ...preset,
            ...(this.config.sigma !== undefined && { sigma: this.config.sigma }),
            ...(this.config.p !== undefined && { p: this.config.p }),
            ...(this.config.phi !== undefined && { phi: this.config.phi }),
            ...(this.config.epsilon !== undefined && { epsilon: this.config.epsilon }),
            ...(this.config.sigmaC !== undefined && { sigmaC: this.config.sigmaC }),
            ...(this.config.sigmaM !== undefined && { sigmaM: this.config.sigmaM }),
            ...(this.config.sigmaA !== undefined && { sigmaA: this.config.sigmaA }),
            useFlow: this.config.useFlow ?? preset.useFlow,
        };
    }
    async apply(input, configOverride) {
        const mergedConfig = { ...this.config, ...configOverride };
        const resolved = new NaturalMediaStrategy(mergedConfig).getResolvedConfig();
        const dog = resolved.useFlow
            ? new FDoG(resolved)
            : new XDoG(resolved);
        const result = dog.process(input);
        dog.dispose();
        return result;
    }
    /**
     * Create strategy for a specific style
     */
    static forStyle(style) {
        return new NaturalMediaStrategy({ style });
    }
}

/**
 * Multi-Scale Strategy Types and Implementation
 *
 * Refactored to use function-based blending, allowing users to either:
 * 1. Use the provided blend functions (average, min, max, multiply)
 * 2. Supply their own custom blend function
 */
// =============================================================================
// Built-in Blend Functions
// =============================================================================
/**
 * Weighted average blend - smoothly combines all layers
 *
 * Best for: Balanced multi-scale results, general purpose
 */
const blendAverage = (ctx) => {
    let sum = 0;
    for (let i = 0; i < ctx.values.length; i++) {
        sum += ctx.values[i] * ctx.weights[i];
    }
    return sum;
};
/**
 * Minimum blend - takes the darkest value at each pixel
 *
 * Best for: Preserving fine details, ensuring all edges are captured
 * Since edges are dark (0) on white (1), min keeps all detected edges
 */
const blendMin = (ctx) => {
    let min = 1;
    for (const value of ctx.values) {
        if (value < min)
            min = value;
    }
    return min;
};
/**
 * Maximum blend - takes the brightest value at each pixel
 *
 * Best for: Abstract styles where only strong edges should appear
 * Removes edges that don't appear in all scales
 */
const blendMax = (ctx) => {
    let max = 0;
    for (const value of ctx.values) {
        if (value > max)
            max = value;
    }
    return max;
};
/**
 * Multiply blend - multiplies all layer values together
 *
 * Best for: Strong edge emphasis, high contrast results
 * Areas that are dark in any layer become very dark
 */
const blendMultiply = (ctx) => {
    let product = 1;
    for (const value of ctx.values) {
        product *= value;
    }
    return product;
};
/**
 * Screen blend - inverse of multiply, brightens the result
 *
 * Best for: Lighter, more ethereal line drawings
 */
const blendScreen = (ctx) => {
    let product = 1;
    for (const value of ctx.values) {
        product *= (1 - value);
    }
    return 1 - product;
};
/**
 * Soft light blend - subtle contrast enhancement
 *
 * Best for: Natural-looking multi-scale combination
 */
const blendSoftLight = (ctx) => {
    // Use weighted average as base, then apply soft light formula
    let base = 0;
    for (let i = 0; i < ctx.values.length; i++) {
        base += ctx.values[i] * ctx.weights[i];
    }
    // Apply soft light with first layer as blend layer
    const blend = ctx.values[0];
    if (blend <= 0.5) {
        return base - (1 - 2 * blend) * base * (1 - base);
    }
    else {
        const d = base <= 0.25
            ? ((16 * base - 12) * base + 4) * base
            : Math.sqrt(base);
        return base + (2 * blend - 1) * (d - base);
    }
};
/**
 * Overlay blend - combines multiply and screen based on base value
 *
 * Best for: High contrast results that preserve both highlights and shadows
 */
const blendOverlay = (ctx) => {
    // Use weighted average as base
    let base = 0;
    for (let i = 0; i < ctx.values.length; i++) {
        base += ctx.values[i] * ctx.weights[i];
    }
    // Overlay formula: multiply darks, screen lights
    if (base < 0.5) {
        let product = 1;
        for (const value of ctx.values) {
            product *= value;
        }
        return 2 * product;
    }
    else {
        let product = 1;
        for (const value of ctx.values) {
            product *= (1 - value);
        }
        return 1 - 2 * product;
    }
};
/**
 * Geometric mean blend - multiplicative average, less extreme than multiply
 *
 * Best for: Balanced darkening that respects layer weights
 */
const blendGeometricMean = (ctx) => {
    let logSum = 0;
    for (let i = 0; i < ctx.values.length; i++) {
        // Add small epsilon to avoid log(0)
        logSum += ctx.weights[i] * Math.log(ctx.values[i] + 1e-6);
    }
    return Math.exp(logSum);
};
/**
 * Harmonic mean blend - emphasizes smaller values more than arithmetic mean
 *
 * Best for: Preserving fine details while still allowing averaging
 */
const blendHarmonicMean = (ctx) => {
    let reciprocalSum = 0;
    for (let i = 0; i < ctx.values.length; i++) {
        // Add small epsilon to avoid division by zero
        reciprocalSum += ctx.weights[i] / (ctx.values[i] + 1e-6);
    }
    return 1 / reciprocalSum;
};
/**
 * Median blend - selects the middle value, robust to outliers
 *
 * Best for: Noise-resistant combination when layer count is odd
 */
const blendMedian = (ctx) => {
    const sorted = [...ctx.values].sort((a, b) => a - b);
    const mid = sorted.length / 2;
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[Math.floor(mid)];
};
/**
 * Soft min blend - smooth approximation of minimum using log-sum-exp
 *
 * Best for: Capturing all edges with smoother transitions than hard min
 */
const blendSoftMin = (ctx) => {
    const k = 8; // Sharpness: higher = closer to true min
    let sumExp = 0;
    for (const value of ctx.values) {
        sumExp += Math.exp(-k * value);
    }
    return -Math.log(sumExp / ctx.values.length) / k;
};
/**
 * Soft max blend - smooth approximation of maximum using log-sum-exp
 *
 * Best for: Selecting dominant edges with smoother transitions than hard max
 */
const blendSoftMax = (ctx) => {
    const k = 8; // Sharpness: higher = closer to true max
    let sumExp = 0;
    for (const value of ctx.values) {
        sumExp += Math.exp(k * value);
    }
    return Math.log(sumExp / ctx.values.length) / k;
};
/**
 * Difference blend - absolute difference between layers (best with 2 layers)
 *
 * Best for: Highlighting scale-dependent features, edge comparison
 */
const blendDifference = (ctx) => {
    if (ctx.values.length === 2) {
        return Math.abs(ctx.values[0] - ctx.values[1]);
    }
    // For multiple layers, compute max difference from weighted average
    let avg = 0;
    for (let i = 0; i < ctx.values.length; i++) {
        avg += ctx.values[i] * ctx.weights[i];
    }
    let maxDiff = 0;
    for (const value of ctx.values) {
        maxDiff = Math.max(maxDiff, Math.abs(value - avg));
    }
    return maxDiff;
};
/**
 * Priority blend - uses fine scale unless coarse scale has strong edges
 *
 * Best for: Detail preservation with fallback to coarse structure
 * Assumes layers ordered fine-to-coarse (first = finest detail)
 */
const blendPriority = (ctx) => {
    // Start with finest layer
    let result = ctx.values[0];
    // Let coarser layers "vote" to override when they have strong edges (dark values)
    for (let i = 1; i < ctx.values.length; i++) {
        const coarseEdgeStrength = 1 - ctx.values[i]; // Invert: dark = strong edge
        // Blend toward coarse value when it has strong edges
        result = result * (1 - coarseEdgeStrength * 0.5) + ctx.values[i] * (coarseEdgeStrength * 0.5);
    }
    return result;
};
/**
 * Collection of all built-in blend functions for easy access
 */
const BlendFunctions = {
    average: blendAverage,
    min: blendMin,
    max: blendMax,
    multiply: blendMultiply,
    screen: blendScreen,
    softLight: blendSoftLight,
    overlay: blendOverlay,
    geometricMean: blendGeometricMean,
    harmonicMean: blendHarmonicMean,
    median: blendMedian,
    softMin: blendSoftMin,
    softMax: blendSoftMax,
    difference: blendDifference,
    priority: blendPriority,
};
// =============================================================================
// Multi-Scale Strategy Implementation
// =============================================================================
/**
 * Multi-Scale Strategy
 *
 * Combines XDoG/FDoG results at different scales for scale-space
 * edge detection. Accepts pre-configured processor instances, giving
 * developers full control over each layer's configuration.
 *
 * From Section 3.1 (Abstraction): Different σ values capture different
 * levels of detail.
 *
 * @example Using built-in blend function
 * ```typescript
 * const multiScale = new MultiScaleStrategy({
 *   layers: [
 *     { processor: new XDoG({ sigma: 0.5, p: 30 }), weight: 1 },
 *     { processor: new FDoG({ sigma: 2.0, sigmaM: 4.0 }), weight: 2 },
 *   ],
 *   blend: BlendFunctions.min,
 * });
 * const result = await multiScale.apply(input);
 * ```
 *
 * @example Using custom blend function
 * ```typescript
 * const multiScale = new MultiScaleStrategy({
 *   layers: [
 *     { processor: new XDoG({ sigma: 0.4, p: 20 }), weight: 2 },
 *     { processor: new FDoG({ sigma: 1.6, sigmaM: 4.0 }), weight: 1 },
 *   ],
 *   blend: (ctx) => {
 *     // Weighted geometric mean
 *     let logSum = 0;
 *     for (let i = 0; i < ctx.values.length; i++) {
 *       logSum += ctx.weights[i] * Math.log(ctx.values[i] + 0.001);
 *     }
 *     return Math.exp(logSum);
 *   },
 * });
 * ```
 *
 * @example Position-dependent blending
 * ```typescript
 * const vignetteBlend: BlendFunction = (ctx) => {
 *   // Use fine details in center, coarse at edges
 *   const cx = ctx.width / 2, cy = ctx.height / 2;
 *   const dist = Math.sqrt((ctx.x - cx) ** 2 + (ctx.y - cy) ** 2);
 *   const maxDist = Math.sqrt(cx ** 2 + cy ** 2);
 *   const t = dist / maxDist; // 0 at center, 1 at corners
 *
 *   // Interpolate between first layer (fine) and last layer (coarse)
 *   return ctx.values[0] * (1 - t) + ctx.values[ctx.values.length - 1] * t;
 * };
 * ```
 */
class MultiScaleStrategy {
    config;
    constructor(config) {
        this.config = config;
    }
    async apply(input, configOverride) {
        const blend = configOverride?.blend ?? this.config.blend;
        const { width, height } = input;
        // Process each layer using its pre-configured processor
        const layerResults = await Promise.all(this.config.layers
            .map(layer => layer.processor.process(input)));
        // Blend layers using the provided function
        return this.blendLayers(layerResults, this.config.layers, blend, width, height);
    }
    blendLayers(layers, layerConfigs, blend, width, height) {
        const output = createChannelImage$1(width, height);
        // Pre-compute normalized weights
        const totalWeight = layerConfigs.reduce((sum, l) => sum + l.weight, 0);
        const normalizedWeights = layerConfigs.map(l => l.weight / totalWeight);
        // Pre-allocate values array for reuse
        const values = new Array(layers.length);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = y * width + x;
                // Gather values from all layers
                for (let j = 0; j < layers.length; j++) {
                    values[j] = layers[j].data[i];
                }
                // Call blend function with full context
                output.data[i] = blend({
                    values,
                    weights: normalizedWeights,
                    x,
                    y,
                    width,
                    height,
                });
            }
        }
        return output;
    }
    /**
     * Create a preset multi-scale configuration
     */
    static withPreset(preset) {
        switch (preset) {
            case 'detailed':
                return new MultiScaleStrategy({
                    layers: [
                        { processor: new XDoG({ sigma: 0.4, p: 25, phi: 50 }), weight: 2 },
                        { processor: new XDoG({ sigma: 1.0, p: 20, phi: 50 }), weight: 1 },
                    ],
                    blend: BlendFunctions.min,
                });
            case 'balanced':
                return new MultiScaleStrategy({
                    layers: [
                        { processor: new XDoG({ sigma: 0.8, p: 20 }), weight: 1 },
                        { processor: new FDoG({ sigma: 1.6, sigmaM: 3.0 }), weight: 2 },
                        { processor: new FDoG({ sigma: 3.2, sigmaM: 5.0 }), weight: 1 },
                    ],
                    blend: BlendFunctions.average,
                });
            case 'abstract':
                return new MultiScaleStrategy({
                    layers: [
                        { processor: new FDoG({ sigma: 2.0, sigmaM: 4.0 }), weight: 1 },
                        { processor: new FDoG({ sigma: 5.0, sigmaM: 6.0 }), weight: 2 },
                        { processor: new FDoG({ sigma: 10.0, sigmaM: 8.0 }), weight: 1 },
                    ],
                    blend: BlendFunctions.max,
                });
        }
    }
    /**
     * Get the configured layers (useful for inspection/debugging)
     */
    getLayers() {
        return this.config.layers;
    }
    /**
     * Get the blend function
     */
    getBlendFunction() {
        return this.config.blend;
    }
}
// =============================================================================
// Utility: Create Custom Blend Functions
// =============================================================================
/**
 * Creates a weighted percentile blend function
 *
 * @param percentile - Value from 0 to 1 (0 = min, 0.5 = median, 1 = max)
 * @returns A blend function that selects the given percentile
 *
 * @example
 * ```typescript
 * const medianBlend = createPercentileBlend(0.5);
 * const multiScale = new MultiScaleStrategy({
 *   layers: [...],
 *   blend: medianBlend,
 * });
 * ```
 */
function createPercentileBlend(percentile) {
    return (ctx) => {
        const sorted = [...ctx.values].sort((a, b) => a - b);
        const index = Math.min(Math.floor(percentile * sorted.length), sorted.length - 1);
        return sorted[index];
    };
}
/**
 * Creates a blend function that interpolates between two other blend functions
 * based on a spatial mask or gradient
 *
 * @param blendA - First blend function
 * @param blendB - Second blend function
 * @param mixer - Function that returns interpolation factor (0 = use A, 1 = use B)
 * @returns Combined blend function
 *
 * @example Radial gradient between min and average
 * ```typescript
 * const radialBlend = createMixedBlend(
 *   BlendFunctions.min,
 *   BlendFunctions.average,
 *   (ctx) => {
 *     const cx = ctx.width / 2, cy = ctx.height / 2;
 *     const dist = Math.hypot(ctx.x - cx, ctx.y - cy);
 *     const maxDist = Math.hypot(cx, cy);
 *     return dist / maxDist;
 *   }
 * );
 * ```
 */
function createMixedBlend(blendA, blendB, mixer) {
    return (ctx) => {
        const a = blendA(ctx);
        const b = blendB(ctx);
        const t = Math.max(0, Math.min(1, mixer(ctx)));
        return a * (1 - t) + b * t;
    };
}
/**
 * Creates a blend function that applies gamma correction to another blend
 *
 * @param baseBlend - The base blend function
 * @param gamma - Gamma value (< 1 brightens, > 1 darkens)
 * @returns Gamma-corrected blend function
 */
function createGammaCorrectedBlend(baseBlend, gamma) {
    return (ctx) => Math.pow(baseBlend(ctx), gamma);
}

var multiScale = /*#__PURE__*/Object.freeze({
    __proto__: null,
    BlendFunctions: BlendFunctions,
    MultiScaleStrategy: MultiScaleStrategy,
    blendAverage: blendAverage,
    blendDifference: blendDifference,
    blendGeometricMean: blendGeometricMean,
    blendHarmonicMean: blendHarmonicMean,
    blendMax: blendMax,
    blendMedian: blendMedian,
    blendMin: blendMin,
    blendMultiply: blendMultiply,
    blendOverlay: blendOverlay,
    blendPriority: blendPriority,
    blendScreen: blendScreen,
    blendSoftLight: blendSoftLight,
    blendSoftMax: blendSoftMax,
    blendSoftMin: blendSoftMin,
    createGammaCorrectedBlend: createGammaCorrectedBlend,
    createMixedBlend: createMixedBlend,
    createPercentileBlend: createPercentileBlend
});

// =============================================================================
// Utility Functions
// =============================================================================
/**
 * Convert ImageData to RGBImage
 */
function imageDataToRGB(imageData) {
    const { width, height } = imageData;
    const size = width * height;
    const rgb = {
        r: new Float32Array(size),
        g: new Float32Array(size),
        b: new Float32Array(size),
        width,
        height,
    };
    for (let i = 0; i < size; i++) {
        rgb.r[i] = imageData.data[i * 4] / 255;
        rgb.g[i] = imageData.data[i * 4 + 1] / 255;
        rgb.b[i] = imageData.data[i * 4 + 2] / 255;
    }
    return rgb;
}
/**
 * Convert RGBImage to ImageData
 */
function rgbToImageData(rgb) {
    const { width, height } = rgb;
    const imageData = new ImageData(width, height);
    const size = width * height;
    for (let i = 0; i < size; i++) {
        imageData.data[i * 4] = Math.round(Math.max(0, Math.min(255, rgb.r[i] * 255)));
        imageData.data[i * 4 + 1] = Math.round(Math.max(0, Math.min(255, rgb.g[i] * 255)));
        imageData.data[i * 4 + 2] = Math.round(Math.max(0, Math.min(255, rgb.b[i] * 255)));
        imageData.data[i * 4 + 3] = 255;
    }
    return imageData;
}
/**
 * Convert grayscale to RGB (same value in all channels)
 */
function grayscaleToRGB(gray) {
    return {
        r: new Float32Array(gray.data),
        g: new Float32Array(gray.data),
        b: new Float32Array(gray.data),
        width: gray.width,
        height: gray.height,
    };
}

/**
 * XDoG/FDoG Extensions Module
 *
 * Provides composable strategy patterns for extending XDoG/FDoG output:
 * - Hatching: Multiple threshold masks for tonal art maps
 * - Natural Media: Pencil, pastel, charcoal effects via parameter tuning
 * - Anti-aliasing: LIC pass along edge tangent flow
 * - Color Retention: Modulating stylized output with source colors
 * - Multi-scale: Combining results at different σ values
 *
 * Based on Sections 4.3, 5.1, 5.2 of:
 * "XDoG: An eXtended difference-of-Gaussians compendium including
 * advanced image stylization" by Winnemöller et al. (2012)
 *
 * Design Philosophy:
 * - Each extension is a standalone strategy that can be composed
 * - Developers control XDoG vs FDoG choice and parameters
 * - Extensions accept pre-processed results or raw images
 * - Chainable pipeline architecture
 */

var index = /*#__PURE__*/Object.freeze({
    __proto__: null,
    AntiAliasingStrategy: AntiAliasingStrategy,
    HatchingStrategy: HatchingStrategy,
    NaturalMediaStrategy: NaturalMediaStrategy,
    colorRetention: colorRetention,
    grayscaleToRGB: grayscaleToRGB,
    imageDataToRGB: imageDataToRGB,
    multiScale: multiScale,
    rgbToImageData: rgbToImageData
});

export { DEFAULT_BILATERAL_CONFIG$3 as DEFAULT_BILATERAL_CONFIG, DEFAULT_CONTRAST_ENHANCEMENT_CONFIG, DEFAULT_ETF_CONFIG, DEFAULT_GAUSSIAN_CONFIG, DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG, DEFAULT_ISOTROPIC_BLUR_CONFIG, DEFAULT_KUWAHARA_CONFIG$3 as DEFAULT_KUWAHARA_CONFIG, DEFAULT_MEDIAN_CONFIG$3 as DEFAULT_MEDIAN_CONFIG, DEFAULT_QUANTIZER_CONFIG, DoGProcessor, EdgeTangentFlowComputer, ThresholdModes, applyCustomThreshold, index$4 as blur, index$5 as dog, index as extensions, index$3 as filters, index$1 as preprocess, threshold, index$6 as utilities };
//# sourceMappingURL=index.mjs.map
