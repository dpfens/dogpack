(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
    typeof define === 'function' && define.amd ? define(['exports'], factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.DogPack = {}));
})(this, (function (exports) { 'use strict';

    /**
     * Image utility functions
     */
    /**
     * Create a new grayscale image with given dimensions
     */
    function createChannelImage(width, height) {
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
        const gray = createChannelImage(rgb.width, rgb.height);
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
        const gray = createChannelImage(imageData.width, imageData.height);
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
     */
    function luminanceToImageData(gray) {
        const imageData = new ImageData(gray.width, gray.height);
        const pixelCount = gray.width * gray.height;
        for (let i = 0; i < pixelCount; i++) {
            const value = Math.max(0, Math.min(255, Math.round(gray.data[i] * 255)));
            imageData.data[i * 4] = value;
            imageData.data[i * 4 + 1] = value;
            imageData.data[i * 4 + 2] = value;
            imageData.data[i * 4 + 3] = 255;
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
    function generateGaussianKernel$2(sigma, size) {
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
     * Compute kernel size from sigma
     * Paper samples at all integer locations less than 2× sigma for flow-aligned,
     * and extends to 2.45σ for structure tensor blur
     *
     * @param sigma Standard deviation
     * @param multiplier Size multiplier (default 6 = 3σ on each side)
     */
    function computeKernelSize(sigma, multiplier = 6) {
        // Ensure odd size for symmetric kernel
        return Math.max(3, Math.floor(sigma * multiplier) | 1);
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
     * Reads a value that may be a scalar (uniform) or a per-pixel ChannelImage.
     */
    function at(value, i) {
        return typeof value === "number" ? value : value.data[i];
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
        const output = createChannelImage(width, height);
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

    var index$4 = /*#__PURE__*/Object.freeze({
        __proto__: null,
        andCombine: andCombine,
        at: at,
        clamp: clamp$1,
        cloneChannelImage: cloneChannelImage,
        computeKernelSize: computeKernelSize,
        createChannelImage: createChannelImage,
        dotVec2: dotVec2,
        gaussianSample: gaussianSample,
        generateGaussianKernel: generateGaussianKernel$2,
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
            const output = createChannelImage(sharpened.width, sharpened.height);
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
     * Equivalent to φ → ∞ in SoftThresholdStrategy, and to ThresholdModes.hard
     * in processor.ts, but expressed as a ThresholdStrategy so it can be plugged
     * into DoGConfig.thresholdStrategy (e.g. as ADoG's default, since the paper's
     * screentone output is binarized rather than soft-thresholded).
     */
    class HardThresholdStrategy {
        threshold(input, config) {
            const output = createChannelImage(input.width, input.height);
            const size = input.width * input.height;
            for (let i = 0; i < size; i++) {
                const eps = at(config.epsilon, i);
                output.data[i] = input.data[i] >= eps ? 1.0 : 0.0;
            }
            return output;
        }
    }
    class HysteresisThresholdStrategy {
        highOffset;
        lowOffset;
        constructor(highOffset = 0.2, lowOffset = 0.2) {
            this.highOffset = highOffset;
            this.lowOffset = lowOffset;
        }
        threshold(sharpened, config) {
            const output = createChannelImage(sharpened.width, sharpened.height);
            const { width, height } = sharpened;
            const edgeMap = createChannelImage(width, height);
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
    const ADOG_PARAM_RANGES = {
        ...DOG_PARAM_RANGES,
        kernelSizeMultiplier: XDOG_PARAM_RANGES.kernelSizeMultiplier,
        k: { hardMin: 1.0, hardMax: Infinity, recommendedMin: 1.6, recommendedMax: 1.6, default: 1.6, step: 0.01 },
        epsilon: { hardMin: 0, hardMax: 1, recommendedMin: 0.0, recommendedMax: 0.2, default: 0.05, step: 0.01 },
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
     * Default FDoG configuration values
     * Based on Table A.1 in the paper
     */
    const DEFAULT_FDOG_CONFIG = {
        ...DEFAULT_DOG_CONFIG,
        sigmaC: FDOG_PARAM_RANGES.sigmaC.default, // Structure tensor smoothing
        sigmaM: FDOG_PARAM_RANGES.sigmaM.default, // Flow-aligned smoothing
        sigmaA: FDOG_PARAM_RANGES.sigmaA.default, // Anti-aliasing
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
    const DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG = {
        kernelSizeMultiplier: 6,
        stepSize: 1.0,
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
     * advanced image stylization" by Winnemöller et al. (2012)
     */
    /**
     * Difference of Gaussians processor
     *
     * Uses the reparameterized formulation (Equation 7):
     * S_σ,k,p(x) = G_σ(x) + p · D_σ,k(x) = (1 + p) · G_σ(x) - p · G_kσ(x)
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
            // G_σ * I and G_kσ * I
            const [blur1, blur2] = await Promise.all([
                this.blurStrategy.blur(input, params.sigma),
                this.blurStrategy.blur(input, params.sigma * params.k)
            ]);
            // Step 2: Compute sharpened image using Equation 7
            // S = (1 + p) * G_σ * I - p * G_kσ * I
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
         * Compute raw Difference of Gaussians: D(x) = G_σ(x) - G_kσ(x)
         * This is the standard DoG without any weighting
         */
        computeDoG(blur1, blur2) {
            const output = createChannelImage(blur1.width, blur1.height);
            const size = blur1.width * blur1.height;
            for (let i = 0; i < size; i++) {
                output.data[i] = blur1.data[i] - blur2.data[i];
            }
            return output;
        }
        /**
         * Compute sharpened image using Equation 7 from the paper:
         * S_σ,k,p(x) = G_σ(x) + p · D_σ,k(x) = (1 + p) · G_σ(x) - p · G_kσ(x)
         *
         * This can be understood as unsharp masking of the blurred image.
         * The parameter p controls the edge sharpening strength independently
         * of the threshold parameters.
         *
         * @param blur1 G_σ * I (smaller blur)
         * @param blur2 G_kσ * I (larger blur)
         * @param p Sharpening strength (p ≈ 20 typical, p ≈ 100 for woodcut)
         */
        computeSharpening(blur1, blur2, p) {
            const output = createChannelImage(blur1.width, blur1.height);
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
        const output = createChannelImage(input.width, input.height);
        const size = input.width * input.height;
        for (let i = 0; i < size; i++) {
            output.data[i] = thresholdFn(input.data[i]);
        }
        return output;
    }

    class BaseCPUBlur {
        dispose() { }
        /**
       * Check if isotropic blur is supported
       * Always returns true as this is a pure JavaScript implementation
       */
        static isSupported() {
            return true;
        }
        /**
         * Get reason if unsupported (always undefined for this implementation)
         */
        static getUnsupportedReason() {
            return undefined;
        }
    }
    class BaseWebGLBlur {
        /**
         * Check if WebGL2 is supported in the current environment
         */
        static isSupported() {
            return isWebGLComputeSupported();
        }
        /**
         * Get reason if WebGL2 is not supported
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
    }
    class BaseWebGPUBlur {
        static cachedAdapter = null;
        static cachedDevice = null;
        static devicePromise = null;
        static adapterInfo = null;
        static isSoftwareRenderer = false;
        /**
         * Check if WebGPU is supported (sync check - just API availability)
         */
        static isSupported() {
            return typeof navigator !== 'undefined' && 'gpu' in navigator;
        }
        /**
         * Get reason if WebGPU is not supported
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
            const device = await BaseWebGPUBlur.getWebGPUDevice();
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
    }

    /**
     * Blur strategies for DoG processing
     *
     * Provides both isotropic (standard) and anisotropic (flow-guided) blur
     * implementations for use in XDoG and FDoG pipelines.
     *
     * FIXED: WebGPUIsotropicBlur now supports parallel/concurrent blur operations
     */
    const DEFAULT_ISOTROPIC_CONFIG = {
        kernelSizeMultiplier: 6,
    };
    /**
     * Standard isotropic Gaussian blur using separable convolution
     * This is the blur used in basic XDoG
     */
    class CPUIsotropicBlur extends BaseCPUBlur {
        config;
        constructor(config = {}) {
            super();
            this.config = { ...DEFAULT_ISOTROPIC_CONFIG, ...config };
        }
        dispose() { }
        async blur(input, sigma) {
            if (sigma < 0.1) {
                // For very small sigma, just return a copy
                return {
                    data: new Float32Array(input.data),
                    width: input.width,
                    height: input.height,
                };
            }
            // Compute kernel size (odd number)
            const kernelSize = computeKernelSize(sigma, this.config.kernelSizeMultiplier);
            const kernel = generateGaussianKernel$2(sigma, kernelSize);
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
    /**
     * Vertex shader for WebGL2 - simple fullscreen quad
     */
    const VERTEX_SHADER$3 = `#version 300 es
  in vec2 a_position;
  in vec2 a_texCoord;
  out vec2 v_texCoord;
  
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;
    /**
     * Fragment shader for horizontal Gaussian blur pass (WebGL2)
     */
    const HORIZONTAL_BLUR_SHADER = `#version 300 es
  precision highp float;
  
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform float u_kernel[64];
  uniform int u_kernelSize;
  
  in vec2 v_texCoord;
  out vec4 fragColor;
  
  void main() {
    vec2 texelSize = 1.0 / u_resolution;
    float result = 0.0;
    int halfSize = u_kernelSize / 2;
    
    for (int i = 0; i < 64; i++) {
      if (i >= u_kernelSize) break;
      int offset = i - halfSize;
      vec2 samplePos = v_texCoord + vec2(float(offset) * texelSize.x, 0.0);
      result += texture(u_image, samplePos).r * u_kernel[i];
    }
    
    fragColor = vec4(result, result, result, 1.0);
  }
`;
    /**
     * Fragment shader for vertical Gaussian blur pass (WebGL2)
     */
    const VERTICAL_BLUR_SHADER = `#version 300 es
  precision highp float;
  
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform float u_kernel[64];
  uniform int u_kernelSize;
  
  in vec2 v_texCoord;
  out vec4 fragColor;
  
  void main() {
    vec2 texelSize = 1.0 / u_resolution;
    float result = 0.0;
    int halfSize = u_kernelSize / 2;
    
    for (int i = 0; i < 64; i++) {
      if (i >= u_kernelSize) break;
      int offset = i - halfSize;
      vec2 samplePos = v_texCoord + vec2(0.0, float(offset) * texelSize.y);
      result += texture(u_image, samplePos).r * u_kernel[i];
    }
    
    fragColor = vec4(result, result, result, 1.0);
  }
`;
    /**
     * Compile a WebGL2 shader
     */
    function compileShader$3(gl, source, type) {
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
    function createProgram$4(gl, vertexSource, fragmentSource) {
        const vertexShader = compileShader$3(gl, vertexSource, gl.VERTEX_SHADER);
        const fragmentShader = compileShader$3(gl, fragmentSource, gl.FRAGMENT_SHADER);
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
    const DEFAULT_WEBGL_CONFIG$1 = {
        kernelSizeMultiplier: 6,
        maxKernelSize: 63,
    };
    /**
     * WebGL2-accelerated isotropic Gaussian blur
     * Uses separable convolution with two passes (horizontal + vertical)
     */
    class WebGLIsotropicBlur extends BaseWebGLBlur {
        config;
        resources = null;
        currentWidth = 0;
        currentHeight = 0;
        framebuffer = null;
        textures = [];
        constructor(config = {}) {
            super();
            this.config = { ...DEFAULT_WEBGL_CONFIG$1, ...config };
        }
        initResources(canvas) {
            if (this.resources)
                return this.resources;
            const gl = canvas.getContext('webgl2');
            if (!gl) {
                throw new Error('WebGL2 not supported');
            }
            const quadBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
            const texCoordBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
            const horizontalBlurProgram = createProgram$4(gl, VERTEX_SHADER$3, HORIZONTAL_BLUR_SHADER);
            const verticalBlurProgram = createProgram$4(gl, VERTEX_SHADER$3, VERTICAL_BLUR_SHADER);
            this.resources = {
                gl,
                canvas,
                horizontalBlurProgram,
                verticalBlurProgram,
                quadBuffer: quadBuffer,
                texCoordBuffer: texCoordBuffer,
            };
            return this.resources;
        }
        async blur(input, sigma) {
            if (sigma < 0.1) {
                return {
                    data: new Float32Array(input.data),
                    width: input.width,
                    height: input.height,
                };
            }
            const canvas = new OffscreenCanvas(1, 1);
            const resources = this.initResources(canvas);
            const { gl } = resources;
            const { width, height } = input;
            const kernelSize = Math.min(this.config.maxKernelSize, Math.max(3, Math.floor(sigma * this.config.kernelSizeMultiplier) | 1));
            const kernel = generateGaussianKernel$2(sigma, kernelSize);
            // Create or reuse textures
            if (this.currentWidth !== width || this.currentHeight !== height) {
                this.textures.forEach(t => gl.deleteTexture(t));
                this.textures = [];
                for (let i = 0; i < 3; i++) {
                    const texture = gl.createTexture();
                    gl.bindTexture(gl.TEXTURE_2D, texture);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, null);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                    this.textures.push(texture);
                }
                if (this.framebuffer) {
                    gl.deleteFramebuffer(this.framebuffer);
                }
                this.framebuffer = gl.createFramebuffer();
                this.currentWidth = width;
                this.currentHeight = height;
            }
            // Upload input data
            gl.bindTexture(gl.TEXTURE_2D, this.textures[0]);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.FLOAT, input.data);
            // Horizontal blur
            this.blurPass(resources, this.textures[0], this.textures[1], kernel, kernelSize, true);
            // Vertical blur
            this.blurPass(resources, this.textures[1], this.textures[2], kernel, kernelSize, false);
            // Read back result
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.framebuffer);
            gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[2], 0);
            const resultData = new Float32Array(width * height);
            gl.readPixels(0, 0, width, height, gl.RED, gl.FLOAT, resultData);
            return {
                data: resultData,
                width,
                height,
            };
        }
        blurPass(resources, inputTexture, outputTexture, kernel, kernelSize, isHorizontal) {
            const { gl, quadBuffer, texCoordBuffer } = resources;
            const program = isHorizontal ? resources.horizontalBlurProgram : resources.verticalBlurProgram;
            gl.useProgram(program);
            gl.viewport(0, 0, this.currentWidth, this.currentHeight);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outputTexture, 0);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, inputTexture);
            gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
            gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), this.currentWidth, this.currentHeight);
            gl.uniform1iv(gl.getUniformLocation(program, 'u_kernel'), Array.from(kernel));
            gl.uniform1i(gl.getUniformLocation(program, 'u_kernelSize'), kernelSize);
            gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
            const posLocation = gl.getAttribLocation(program, 'a_position');
            gl.vertexAttribPointer(posLocation, 2, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(posLocation);
            gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
            const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
            gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(texCoordLocation);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        dispose() {
            if (this.resources) {
                const { gl } = this.resources;
                gl.deleteProgram(this.resources.horizontalBlurProgram);
                gl.deleteProgram(this.resources.verticalBlurProgram);
                gl.deleteBuffer(this.resources.quadBuffer);
                gl.deleteBuffer(this.resources.texCoordBuffer);
            }
            const { gl } = this.resources || { gl: null };
            if (gl) {
                this.textures.forEach(t => gl.deleteTexture(t));
                if (this.framebuffer) {
                    gl.deleteFramebuffer(this.framebuffer);
                }
            }
            this.resources = null;
            this.textures = [];
            this.framebuffer = null;
            this.currentWidth = 0;
            this.currentHeight = 0;
        }
    }
    const DEFAULT_WEBGPU_CONFIG$1 = {
        kernelSizeMultiplier: 6,
        maxKernelSize: 63,
    };
    const HORIZONTAL_BLUR_WGSL = `
struct Params {
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
}
`;
    const VERTICAL_BLUR_WGSL = `
struct Params {
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
}
`;
    /**
     * WebGPU-accelerated isotropic Gaussian blur
     * Uses compute shaders with separable convolution
     *
     * FIXED: Now supports concurrent/parallel blur calls by creating
     * separate staging buffers for each operation instead of reusing one.
     */
    class WebGPUIsotropicBlur extends BaseWebGPUBlur {
        config;
        resources = null;
        // Reusable buffers for compute operations
        paramsBuffer = null;
        kernelBuffer = null;
        inputBuffer = null;
        tempBuffer = null;
        outputBuffer = null;
        currentBufferSize = 0;
        currentKernelSize = 0;
        constructor(config = {}) {
            super();
            this.config = { ...DEFAULT_WEBGPU_CONFIG$1, ...config };
        }
        /**
         * Initialize WebGPU resources
         */
        async initResources() {
            if (this.resources)
                return this.resources;
            const device = await WebGPUIsotropicBlur.getWebGPUDevice();
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
                    module: device.createShaderModule({ code: HORIZONTAL_BLUR_WGSL }),
                    entryPoint: 'main',
                },
            });
            const verticalPipeline = device.createComputePipeline({
                layout: pipelineLayout,
                compute: {
                    module: device.createShaderModule({ code: VERTICAL_BLUR_WGSL }),
                    entryPoint: 'main',
                },
            });
            this.resources = {
                device,
                horizontalPipeline,
                verticalPipeline,
                bindGroupLayout,
            };
            return this.resources;
        }
        /**
         * Ensure buffers are sized correctly
         */
        ensureBuffers(device, pixelCount, kernelSize) {
            const bufferSize = pixelCount * 4; // Float32
            if (this.currentBufferSize < bufferSize) {
                // Clean up old buffers
                this.inputBuffer?.destroy();
                this.tempBuffer?.destroy();
                this.outputBuffer?.destroy();
                this.inputBuffer = device.createBuffer({
                    size: bufferSize,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                });
                this.tempBuffer = device.createBuffer({
                    size: bufferSize,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
                });
                this.outputBuffer = device.createBuffer({
                    size: bufferSize,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
                });
                this.currentBufferSize = bufferSize;
            }
            if (this.currentKernelSize < kernelSize) {
                this.kernelBuffer?.destroy();
                this.kernelBuffer = device.createBuffer({
                    size: kernelSize * 4,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                });
                this.currentKernelSize = kernelSize;
            }
            if (!this.paramsBuffer) {
                this.paramsBuffer = device.createBuffer({
                    size: 16, // 4 x u32
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                });
            }
        }
        /**
         * Blur implementation - supports concurrent/parallel calls
         *
         * KEY FIX: Creates a new staging buffer for each operation instead of
         * reusing a single one. This prevents "Buffer already has an outstanding
         * map pending" errors when blur() is called in parallel.
         */
        async blur(input, sigma) {
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
            // Compute kernel
            const kernelSize = Math.min(this.config.maxKernelSize, Math.max(3, Math.floor(sigma * this.config.kernelSizeMultiplier) | 1));
            const kernel = generateGaussianKernel$2(sigma, kernelSize);
            // Ensure buffers
            this.ensureBuffers(device, pixelCount, kernelSize);
            // Upload data
            device.queue.writeBuffer(this.paramsBuffer, 0, new Uint32Array([width, height, kernelSize, 0]));
            device.queue.writeBuffer(this.kernelBuffer, 0, new Float32Array(kernel));
            device.queue.writeBuffer(this.inputBuffer, 0, new Float32Array(input.data));
            // Create bind groups
            const horizontalBindGroup = device.createBindGroup({
                layout: bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.paramsBuffer } },
                    { binding: 1, resource: { buffer: this.kernelBuffer } },
                    { binding: 2, resource: { buffer: this.inputBuffer } },
                    { binding: 3, resource: { buffer: this.tempBuffer } },
                ],
            });
            const verticalBindGroup = device.createBindGroup({
                layout: bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.paramsBuffer } },
                    { binding: 1, resource: { buffer: this.kernelBuffer } },
                    { binding: 2, resource: { buffer: this.tempBuffer } },
                    { binding: 3, resource: { buffer: this.outputBuffer } },
                ],
            });
            // Dispatch compute
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
            // FIX: Create a NEW staging buffer for this operation instead of reusing one.
            // This prevents concurrent map() calls from conflicting.
            const stagingBuffer = device.createBuffer({
                size: pixelCount * 4,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            });
            // Copy result to the new staging buffer
            commandEncoder.copyBufferToBuffer(this.outputBuffer, 0, stagingBuffer, 0, pixelCount * 4);
            device.queue.submit([commandEncoder.finish()]);
            // Read back result - safe because this stagingBuffer is unique to this call
            await stagingBuffer.mapAsync(GPUMapMode.READ);
            const resultData = new Float32Array(stagingBuffer.getMappedRange().slice(0));
            stagingBuffer.unmap();
            // Clean up the staging buffer (it was created just for this operation)
            stagingBuffer.destroy();
            return {
                data: resultData,
                width,
                height,
            };
        }
        /**
         * Clean up GPU resources
         */
        dispose() {
            this.paramsBuffer?.destroy();
            this.kernelBuffer?.destroy();
            this.inputBuffer?.destroy();
            this.tempBuffer?.destroy();
            this.outputBuffer?.destroy();
            this.paramsBuffer = null;
            this.kernelBuffer = null;
            this.inputBuffer = null;
            this.tempBuffer = null;
            this.outputBuffer = null;
            this.currentBufferSize = 0;
            this.currentKernelSize = 0;
            // Note: We don't destroy the device as it's shared
            this.resources = null;
        }
    }
    class IsotropicBlur {
        instance;
        constructor(config) {
            if (WebGPUIsotropicBlur.isSupported()) {
                this.instance = new WebGPUIsotropicBlur(config);
            }
            else if (WebGLIsotropicBlur.isSupported()) {
                this.instance = new WebGLIsotropicBlur(config);
            }
            else {
                this.instance = new CPUIsotropicBlur(config);
            }
        }
        dispose() {
            this.instance.dispose();
        }
        async blur(input, sigma) {
            return this.instance.blur(input, sigma);
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
        processor;
        config;
        constructor(config = {}) {
            const { kernelSizeMultiplier, ...dogConfig } = config;
            this.config = { ...DEFAULT_DOG_CONFIG, kernelSizeMultiplier: 6, ...config };
            const blurStrategy = config.blurStrategy ?? new IsotropicBlur({
                kernelSizeMultiplier: this.config.kernelSizeMultiplier,
            });
            this.processor = new DoGProcessor(blurStrategy, dogConfig);
        }
        dispose() {
            this.processor.dispose();
        }
        /**
         * Create XDoG with a preset style
         */
        static withPreset(presetName) {
            return new XDoG(STYLE_PRESETS[presetName]);
        }
        /**
         * Process a grayscale image
         */
        async process(input, overrides = {}) {
            return this.processor.process(input, overrides);
        }
        /**
         * Process without thresholding (returns sharpened image)
         */
        async processSharpened(input, overrides = {}) {
            return this.processor.processNoThreshold(input, overrides);
        }
        /**
         * Get raw DoG response for visualization
         */
        async processRawDoG(input, overrides = {}) {
            return this.processor.processRawDoG(input, overrides);
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
            return this.processor.processDetailed(input, overrides);
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
         * Get current configuration
         */
        getConfig() {
            return { ...this.config, ...this.processor.getConfig() };
        }
        /**
         * Update configuration
         */
        setConfig(config) {
            const { kernelSizeMultiplier, ...dogConfig } = config;
            if (kernelSizeMultiplier !== undefined) {
                this.config.kernelSizeMultiplier = kernelSizeMultiplier;
                // Need to recreate blur strategy with new kernel size
                const blurStrategy = new IsotropicBlur({ kernelSizeMultiplier });
                this.processor.setBlurStrategy(blurStrategy);
            }
            this.processor.setConfig(dogConfig);
        }
    }
    /**
     * Convenience function for one-shot XDoG processing
     */
    async function xdog(input, config = {}) {
        const processor = new XDoG(config);
        const result = processor.process(input);
        processor.dispose();
        return result;
    }

    /**
     * WebGPU-accelerated Edge Tangent Flow computation
     *
     * Functional port of the WebGL2 implementation (webgl.ts) onto WebGPU
     * compute shaders. Structurally this is much simpler than the WebGL version:
     * there's no canvas, no framebuffers, and no fragment-shader ping-pong —
     * every stage is a compute pass over flat storage buffers, addressed by
     * (y * width + x) instead of texture coordinates. Edge-clamping is done
     * manually via clampIdx() rather than relying on CLAMP_TO_EDGE sampler state.
     *
     * NOTE: like the WebGL version's fixed `u_kernel[33]` uniform array (which
     * capped the Gaussian blur radius at 16), the WebGL implementation had to
     * work around GLSL's lack of dynamically-sized arrays. Storage buffers have
     * no such limit here, so the blur radius is only bounded by sanity/perf
     * limits, not by shader syntax — see MAX_BLUR_RADIUS below.
     */
    // NOTE: isWebGPUComputeSupported() isn't assumed to exist in utils/index.js
    // yet (only isWebGLComputeSupported is referenced in webgl.ts), so a local
    // equivalent is defined at the bottom of this file. Feel free to hoist it
    // into utils/index.js as a sibling of isWebGLComputeSupported.
    /** Sanity cap on Gaussian blur radius (pixels). Not a shader limitation —
     *  just guards against pathological sigma values blowing up dispatch cost. */
    const MAX_BLUR_RADIUS = 64;
    const WORKGROUP_SIZE$1 = 8;
    // ============== WGSL Shader Sources ==============
    const COMMON_WGSL = `
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
}
`;
    const GRADIENT_SHADER$1 = COMMON_WGSL + `
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputBuf: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputBuf: array<vec4<f32>>;

@compute @workgroup_size(${WORKGROUP_SIZE$1}, ${WORKGROUP_SIZE$1})
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
  let mag = length(vec2<f32>(gx, gy));

  // R=gx, G=gy, B=magnitude
  outputBuf[u32(y * w + x)] = vec4<f32>(gx, gy, mag, 1.0);
}
`;
    const STRUCTURE_TENSOR_SHADER$1 = COMMON_WGSL + `
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> gradBuf: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outputBuf: array<vec4<f32>>;

@compute @workgroup_size(${WORKGROUP_SIZE$1}, ${WORKGROUP_SIZE$1})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = i32(params.width);
  let h = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let idx = u32(y * w + x);
  let grad = gradBuf[idx];
  let gx = grad.x;
  let gy = grad.y;

  // Structure tensor: E=gx^2, F=gx*gy, G=gy^2
  let e = gx * gx;
  let f = gx * gy;
  let g = gy * gy;

  // R=E, G=F, B=G, A=magnitude (passed through)
  outputBuf[idx] = vec4<f32>(e, f, g, grad.z);
}
`;
    // Both blur directions live in the same module — WGSL allows multiple
    // @compute entry points per shader module, so this replaces the WebGL
    // version's two separate H/V programs with one module and two pipelines.
    const GAUSSIAN_BLUR_SHADER = COMMON_WGSL + `
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputBuf: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outputBuf: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> kernelBuf: array<f32>;

@compute @workgroup_size(${WORKGROUP_SIZE$1}, ${WORKGROUP_SIZE$1})
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

@compute @workgroup_size(${WORKGROUP_SIZE$1}, ${WORKGROUP_SIZE$1})
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
}
`;
    const TANGENT_EXTRACT_SHADER$1 = COMMON_WGSL + `
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> tensorBuf: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outputBuf: array<vec4<f32>>;

@compute @workgroup_size(${WORKGROUP_SIZE$1}, ${WORKGROUP_SIZE$1})
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
  let mag = tensor.w;

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

  // R=tx, G=ty, B=magnitude (for refinement weighting)
  outputBuf[idx] = vec4<f32>(tangent, mag, 1.0);
}
`;
    const TANGENT_REFINE_SHADER$1 = COMMON_WGSL + `
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputBuf: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outputBuf: array<vec4<f32>>;

@compute @workgroup_size(${WORKGROUP_SIZE$1}, ${WORKGROUP_SIZE$1})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = i32(params.width);
  let h = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let idx = u32(y * w + x);
  let current = inputBuf[idx];
  let currentT = current.xy;

  var sum = vec2<f32>(0.0);
  var weightSum: f32 = 0.0;

  // 5x5 kernel (radius 2)
  for (var ky = -2; ky <= 2; ky = ky + 1) {
    for (var kx = -2; kx <= 2; kx = kx + 1) {
      let neighbor = inputBuf[clampIdx(x + kx, y + ky, w, h)];
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

  outputBuf[idx] = vec4<f32>(refined, current.z, 1.0);
}
`;
    /**
     * WebGPU-accelerated ETF implementation
     */
    class EdgeTangentFlowWebGPU {
        // Flat, stride-2 (x,y) buffer — avoids allocating pixelCount JS objects.
        tangents;
        width;
        height;
        static resources = null;
        static resourcesPromise = null;
        constructor(tangents, width, height) {
            this.tangents = tangents;
            this.width = width;
            this.height = height;
        }
        getTangent(x, y) {
            const clampedX = Math.max(0, Math.min(this.width - 1, Math.round(x)));
            const clampedY = Math.max(0, Math.min(this.height - 1, Math.round(y)));
            const idx = (clampedY * this.width + clampedX) * 2;
            return { x: this.tangents[idx], y: this.tangents[idx + 1] };
        }
        getTangentArray() {
            // Already stored in exactly this layout — just hand back a copy so
            // callers can't mutate internal state out from under us.
            return this.tangents.slice();
        }
        /**
         * Cheap synchronous check — mirrors the shape of isWebGLComputeSupported().
         * This only confirms the API surface exists; it can't confirm an adapter
         * is actually obtainable (that requires the async requestAdapter() call
         * made lazily inside initResources/compute).
         */
        static isSupported() {
            return typeof navigator !== 'undefined' && !!navigator.gpu;
        }
        /**
         * Optional richer diagnostic, matching the BlurStrategyClass shape used
         * elsewhere in this codebase (see types.ts).
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
                console.debug('[EdgeTangentFlowWebGPU] initResources: cache HIT (no GPU work)');
                return this.resources;
            }
            if (this.resourcesPromise) {
                console.debug('[EdgeTangentFlowWebGPU] initResources: awaiting in-flight init');
                return this.resourcesPromise;
            }
            console.debug('[EdgeTangentFlowWebGPU] initResources: cache MISS — cold init starting');
            this.resourcesPromise = (async () => {
                const initTimings = {};
                const tInitStart = performance.now();
                if (!navigator.gpu) {
                    throw new Error('WebGPU not supported in this environment');
                }
                const tAdapter = performance.now();
                const adapter = await navigator.gpu.requestAdapter();
                initTimings.requestAdapter = performance.now() - tAdapter;
                if (!adapter) {
                    throw new Error('Failed to obtain a WebGPU adapter');
                }
                const hasTimestampQuery = adapter.features.has('timestamp-query');
                const tDevice = performance.now();
                const device = await adapter.requestDevice({
                    requiredFeatures: hasTimestampQuery ? ['timestamp-query'] : [],
                });
                initTimings.requestDevice = performance.now() - tDevice;
                device.lost.then((info) => {
                    // Invalidate the cache so the next compute() call re-initializes.
                    if (this.resources && this.resources.device === device) {
                        this.resources = null;
                        this.resourcesPromise = null;
                    }
                    console.warn(`WebGPU device lost: ${info.message}`);
                });
                const tPipelines = performance.now();
                const makePipeline = (code, entryPoint = 'main') => device.createComputePipeline({
                    layout: 'auto',
                    compute: {
                        module: device.createShaderModule({ code }),
                        entryPoint,
                    },
                });
                const blurModule = device.createShaderModule({ code: GAUSSIAN_BLUR_SHADER });
                const blurHPipeline = device.createComputePipeline({
                    layout: 'auto',
                    compute: { module: blurModule, entryPoint: 'blurH' },
                });
                const blurVPipeline = device.createComputePipeline({
                    layout: 'auto',
                    compute: { module: blurModule, entryPoint: 'blurV' },
                });
                const resources = {
                    device,
                    gradientPipeline: makePipeline(GRADIENT_SHADER$1),
                    structureTensorPipeline: makePipeline(STRUCTURE_TENSOR_SHADER$1),
                    blurHPipeline,
                    blurVPipeline,
                    tangentExtractPipeline: makePipeline(TANGENT_EXTRACT_SHADER$1),
                    tangentRefinePipeline: makePipeline(TANGENT_REFINE_SHADER$1),
                    hasTimestampQuery,
                };
                // NOTE: createComputePipeline() with layout:'auto' returns synchronously,
                // but WGSL compilation/validation may be deferred by the driver until
                // first dispatch — so this number can understate true compile cost.
                // If submitAndGpuWait's first-call time is much higher than later
                // calls, that deferred cost is showing up there, not here.
                initTimings.pipelineCreateSync = performance.now() - tPipelines;
                initTimings.total = performance.now() - tInitStart;
                console.debug('[EdgeTangentFlowWebGPU] cold init timings (ms):', initTimings);
                this.resources = resources;
                return resources;
            })();
            return this.resourcesPromise;
        }
        /**
         * Compute ETF using WebGPU compute shaders.
         *
         * Note this is async (unlike the WebGL version's synchronous compute()),
         * since device acquisition and the final buffer readback (mapAsync) are
         * both inherently asynchronous in WebGPU.
         */
        static async compute(input, config = {}, sigmaC) {
            const cfg = { ...DEFAULT_ETF_CONFIG, ...config };
            const { width, height } = input;
            const pixelCount = width * height;
            const timings = {};
            const tStart = performance.now();
            const res = await this.initResources();
            const { device } = res;
            timings.resourceInit = performance.now() - tStart;
            // ---- Buffers ----
            const tBuffers = performance.now();
            const inputBuf = createBufferWithData(device, input.data, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
            const gradientBuf = createEmptyVec4Buffer(device, pixelCount);
            const tensorBuf = createEmptyVec4Buffer(device, pixelCount);
            const blurTempBuf = createEmptyVec4Buffer(device, pixelCount);
            const blurOutputBuf = createEmptyVec4Buffer(device, pixelCount);
            const tangentBuf1 = createEmptyVec4Buffer(device, pixelCount);
            const tangentBuf2 = createEmptyVec4Buffer(device, pixelCount);
            const smoothSigma = sigmaC ?? cfg.kernelSize / 2.45;
            const radius = Math.min(MAX_BLUR_RADIUS, Math.max(1, Math.ceil(smoothSigma * 2.45)));
            const kernelSize = radius * 2 + 1;
            const kernel = generateGaussianKernel$1(smoothSigma, kernelSize);
            const kernelBuf = createBufferWithData(device, kernel, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
            timings.bufferSetup = performance.now() - tBuffers;
            const dispatchX = Math.ceil(width / WORKGROUP_SIZE$1);
            const dispatchY = Math.ceil(height / WORKGROUP_SIZE$1);
            // ---- Optional per-pass GPU timing (requires 'timestamp-query') ----
            // 5 fixed passes (gradient, tensor, blurH, blurV, tangentExtract) plus
            // one per refine iteration. Each pass writes a begin+end timestamp.
            const passLabels = [];
            const numPasses = 5 + cfg.iterations;
            const querySet = res.hasTimestampQuery
                ? device.createQuerySet({ type: 'timestamp', count: numPasses * 2 })
                : null;
            let passIdx = 0;
            const nextTimestampWrites = (label) => {
                if (!querySet)
                    return undefined;
                const writes = {
                    querySet,
                    beginningOfPassWriteIndex: passIdx * 2,
                    endOfPassWriteIndex: passIdx * 2 + 1,
                };
                passLabels.push(label);
                passIdx++;
                return writes;
            };
            const tEncode = performance.now();
            const encoder = device.createCommandEncoder();
            // Step 1: Compute gradients
            {
                const params = createParamsBuffer(device, { width, height, radius: 0, kernelSize: 0 });
                const bindGroup = device.createBindGroup({
                    layout: res.gradientPipeline.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: params } },
                        { binding: 1, resource: { buffer: inputBuf } },
                        { binding: 2, resource: { buffer: gradientBuf } },
                    ],
                });
                const pass = encoder.beginComputePass({ timestampWrites: nextTimestampWrites('gradient') });
                pass.setPipeline(res.gradientPipeline);
                pass.setBindGroup(0, bindGroup);
                pass.dispatchWorkgroups(dispatchX, dispatchY);
                pass.end();
            }
            // Step 2: Build structure tensor
            {
                const params = createParamsBuffer(device, { width, height, radius: 0, kernelSize: 0 });
                const bindGroup = device.createBindGroup({
                    layout: res.structureTensorPipeline.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: params } },
                        { binding: 1, resource: { buffer: gradientBuf } },
                        { binding: 2, resource: { buffer: tensorBuf } },
                    ],
                });
                const pass = encoder.beginComputePass({ timestampWrites: nextTimestampWrites('structureTensor') });
                pass.setPipeline(res.structureTensorPipeline);
                pass.setBindGroup(0, bindGroup);
                pass.dispatchWorkgroups(dispatchX, dispatchY);
                pass.end();
            }
            // Step 3: Gaussian blur the structure tensor (horizontal then vertical)
            {
                const params = createParamsBuffer(device, { width, height, radius, kernelSize });
                const bindGroupH = device.createBindGroup({
                    layout: res.blurHPipeline.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: params } },
                        { binding: 1, resource: { buffer: tensorBuf } },
                        { binding: 2, resource: { buffer: blurTempBuf } },
                        { binding: 3, resource: { buffer: kernelBuf } },
                    ],
                });
                const passH = encoder.beginComputePass({ timestampWrites: nextTimestampWrites('blurH') });
                passH.setPipeline(res.blurHPipeline);
                passH.setBindGroup(0, bindGroupH);
                passH.dispatchWorkgroups(dispatchX, dispatchY);
                passH.end();
                const bindGroupV = device.createBindGroup({
                    layout: res.blurVPipeline.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: params } },
                        { binding: 1, resource: { buffer: blurTempBuf } },
                        { binding: 2, resource: { buffer: blurOutputBuf } },
                        { binding: 3, resource: { buffer: kernelBuf } },
                    ],
                });
                const passV = encoder.beginComputePass({ timestampWrites: nextTimestampWrites('blurV') });
                passV.setPipeline(res.blurVPipeline);
                passV.setBindGroup(0, bindGroupV);
                passV.dispatchWorkgroups(dispatchX, dispatchY);
                passV.end();
            }
            // Step 4: Extract initial tangent field
            {
                const params = createParamsBuffer(device, { width, height, radius: 0, kernelSize: 0 });
                const bindGroup = device.createBindGroup({
                    layout: res.tangentExtractPipeline.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: params } },
                        { binding: 1, resource: { buffer: blurOutputBuf } },
                        { binding: 2, resource: { buffer: tangentBuf1 } },
                    ],
                });
                const pass = encoder.beginComputePass({ timestampWrites: nextTimestampWrites('tangentExtract') });
                pass.setPipeline(res.tangentExtractPipeline);
                pass.setBindGroup(0, bindGroup);
                pass.dispatchWorkgroups(dispatchX, dispatchY);
                pass.end();
            }
            // Step 5: Refine tangent field iteratively (ping-pong between buffers)
            let readBuf = tangentBuf1;
            let writeBuf = tangentBuf2;
            const params = createParamsBuffer(device, { width, height, radius: 0, kernelSize: 0 });
            for (let i = 0; i < cfg.iterations; i++) {
                const bindGroup = device.createBindGroup({
                    layout: res.tangentRefinePipeline.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: params } },
                        { binding: 1, resource: { buffer: readBuf } },
                        { binding: 2, resource: { buffer: writeBuf } },
                    ],
                });
                const pass = encoder.beginComputePass({ timestampWrites: nextTimestampWrites(`refine[${i}]`) });
                pass.setPipeline(res.tangentRefinePipeline);
                pass.setBindGroup(0, bindGroup);
                pass.dispatchWorkgroups(dispatchX, dispatchY);
                pass.end();
                [readBuf, writeBuf] = [writeBuf, readBuf];
            }
            timings.encode = performance.now() - tEncode;
            // ---- Phase A: submit compute passes only, wait for GPU completion ----
            // (No buffer copies here yet — resolveQuerySet writes GPU-side only,
            // it doesn't require a CPU-readable buffer.)
            let queryResolveBuf = null;
            if (querySet) {
                queryResolveBuf = device.createBuffer({
                    size: numPasses * 2 * 8, // one u64 timestamp per write index
                    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
                });
                encoder.resolveQuerySet(querySet, 0, numPasses * 2, queryResolveBuf, 0);
            }
            const tFinishSubmit = performance.now();
            device.queue.submit([encoder.finish()]);
            timings.encoderFinishAndSubmitCall = performance.now() - tFinishSubmit;
            // onSubmittedWorkDone() resolves once the GPU has finished executing
            // everything in this submit — pure compute-pass execution time,
            // including any first-use pipeline compile/link stall the driver
            // deferred from createComputePipeline(). No copy or map involved yet.
            const tComputeWait = performance.now();
            await device.queue.onSubmittedWorkDone();
            timings.computeGpuWait = performance.now() - tComputeWait;
            // ---- Phase B: copy results into mappable buffers, then map+read ----
            const tCopyEncode = performance.now();
            const byteSize = pixelCount * 4 * 4; // vec4<f32>
            const stagingBuf = device.createBuffer({
                size: byteSize,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
            let queryReadBuf = null;
            const copyEncoder = device.createCommandEncoder();
            copyEncoder.copyBufferToBuffer(readBuf, 0, stagingBuf, 0, byteSize);
            if (querySet && queryResolveBuf) {
                queryReadBuf = device.createBuffer({
                    size: queryResolveBuf.size,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
                });
                copyEncoder.copyBufferToBuffer(queryResolveBuf, 0, queryReadBuf, 0, queryResolveBuf.size);
            }
            device.queue.submit([copyEncoder.finish()]);
            timings.copyEncodeAndSubmit = performance.now() - tCopyEncode;
            const tMapWait = performance.now();
            const mapPromises = [stagingBuf.mapAsync(GPUMapMode.READ)];
            if (queryReadBuf)
                mapPromises.push(queryReadBuf.mapAsync(GPUMapMode.READ));
            await Promise.all(mapPromises);
            timings.mapAsyncWait = performance.now() - tMapWait;
            // Everything from "done encoding compute passes" to "results mapped":
            timings.submitAndGpuWait =
                timings.encoderFinishAndSubmitCall + timings.computeGpuWait + timings.copyEncodeAndSubmit + timings.mapAsyncWait;
            if (queryReadBuf) {
                const raw = new BigUint64Array(queryReadBuf.getMappedRange().slice(0));
                queryReadBuf.unmap();
                queryReadBuf.destroy();
                queryResolveBuf.destroy();
                querySet.destroy();
                const gpuPassTimings = {};
                for (let i = 0; i < passLabels.length; i++) {
                    const beginNs = raw[i * 2];
                    const endNs = raw[i * 2 + 1];
                    // Aggregate refine[i] entries under one key so a large `iterations`
                    // count doesn't spam the log with per-iteration lines.
                    const label = passLabels[i].startsWith('refine[') ? 'refine (sum)' : passLabels[i];
                    const ms = Number(endNs - beginNs) / 1e6;
                    gpuPassTimings[label] = (gpuPassTimings[label] ?? 0) + ms;
                }
                console.debug('[EdgeTangentFlowWebGPU] per-pass GPU timings (ms):', gpuPassTimings);
            }
            else if (res.hasTimestampQuery === false) {
                // Only warn once per session-ish; cheap enough to just always note it.
                console.debug('[EdgeTangentFlowWebGPU] timestamp-query unsupported on this device — ' +
                    'submitAndGpuWait is a single coarse number, not broken down by pass.');
            }
            const tUnpack = performance.now();
            const mapped = new Float32Array(stagingBuf.getMappedRange().slice(0));
            stagingBuf.unmap();
            // Flat stride-2 copy — no per-pixel object allocation. `mapped` is
            // stride-4 (x,y,mag,1); we only keep (x,y) per pixel.
            const tangents = new Float32Array(pixelCount * 2);
            for (let i = 0; i < pixelCount; i++) {
                tangents[i * 2] = mapped[i * 4];
                tangents[i * 2 + 1] = mapped[i * 4 + 1];
            }
            timings.cpuUnpack = performance.now() - tUnpack;
            // Cleanup temporary (per-call) resources — pipelines/device are cached.
            const tCleanup = performance.now();
            inputBuf.destroy();
            gradientBuf.destroy();
            tensorBuf.destroy();
            blurTempBuf.destroy();
            blurOutputBuf.destroy();
            tangentBuf1.destroy();
            tangentBuf2.destroy();
            kernelBuf.destroy();
            stagingBuf.destroy();
            timings.cleanup = performance.now() - tCleanup;
            timings.total = performance.now() - tStart;
            console.debug('[EdgeTangentFlowWebGPU] timings (ms):', timings);
            return new EdgeTangentFlowWebGPU(tangents, width, height);
        }
        /**
         * Visualize the flow field as a grayscale image
         */
        visualize() {
            const output = createChannelImage(this.width, this.height);
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    const idx = y * this.width + x;
                    const tx = this.tangents[idx * 2];
                    const ty = this.tangents[idx * 2 + 1];
                    const angle = Math.atan2(ty, tx);
                    output.data[idx] = (angle + Math.PI) / (2 * Math.PI);
                }
            }
            return output;
        }
        /**
         * Cleanup WebGPU resources (call when done with all ETF computations)
         */
        static dispose() {
            const t0 = performance.now();
            if (this.resources) {
                this.resources.device.destroy();
                this.resources = null;
                this.resourcesPromise = null;
                console.debug(`[EdgeTangentFlowWebGPU] dispose(): device destroyed in ${(performance.now() - t0).toFixed(2)}ms — ` +
                    'cache is now EMPTY; next compute() call will pay full cold-init cost.');
            }
            else {
                console.debug(`[EdgeTangentFlowWebGPU] dispose(): no-op, resources already empty (${(performance.now() - t0).toFixed(2)}ms)`);
            }
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
            size: 16, // 4 x u32, already 16-byte aligned
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(buffer, 0, new Uint32Array([params.width, params.height, params.radius, params.kernelSize]));
        return buffer;
    }
    function generateGaussianKernel$1(sigma, size) {
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
     * WebGL-accelerated Edge Tangent Flow computation
     *
     * Provides significant speedup over CPU implementation by running
     * gradient computation, structure tensor building/smoothing, and
     * tangent extraction on the GPU.
     */
    /**
     * Shader source code
     */
    const VERTEX_SHADER$2 = `#version 300 es
precision highp float;
in vec2 a_position;
out vec2 v_texCoord;

void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;
    const GRADIENT_SHADER = `#version 300 es
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
}
`;
    const STRUCTURE_TENSOR_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_gradients;

in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor;

void main() {
  vec4 grad = texture(u_gradients, v_texCoord);
  float gx = grad.r;
  float gy = grad.g;
  
  // Structure tensor: E=gx², F=gx*gy, G=gy²
  float e = gx * gx;
  float f = gx * gy;
  float g = gy * gy;
  
  // Output: R=E, G=F, B=G, A=magnitude (passed through)
  fragColor = vec4(e, f, g, grad.b);
}
`;
    const GAUSSIAN_BLUR_H_SHADER = `#version 300 es
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
}
`;
    const GAUSSIAN_BLUR_V_SHADER = `#version 300 es
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
}
`;
    const TANGENT_EXTRACT_SHADER = `#version 300 es
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
  
  // Output: R=tx, G=ty, B=magnitude (for refinement weighting)
  fragColor = vec4(tangent, mag, 1.0);
}
`;
    const TANGENT_REFINE_SHADER = `#version 300 es
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
  
  fragColor = vec4(refined, current.b, 1.0);
}
`;
    /**
     * WebGL-accelerated ETF implementation
     */
    class EdgeTangentFlowWebGL {
        tangents;
        width;
        height;
        static resources = null;
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
        getTangentArray() {
            const result = new Float32Array(this.width * this.height * 2);
            for (let i = 0; i < this.tangents.length; i++) {
                result[i * 2] = this.tangents[i].x;
                result[i * 2 + 1] = this.tangents[i].y;
            }
            return result;
        }
        /**
         * Check if WebGL2 is supported
         */
        static isSupported() {
            return isWebGLComputeSupported();
        }
        /**
         * Initialize WebGL resources (lazy initialization)
         */
        static initResources(width, height) {
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
            const gradientProgram = createProgram$3(gl, VERTEX_SHADER$2, GRADIENT_SHADER);
            const structureTensorProgram = createProgram$3(gl, VERTEX_SHADER$2, STRUCTURE_TENSOR_SHADER);
            const gaussianBlurHProgram = createProgram$3(gl, VERTEX_SHADER$2, GAUSSIAN_BLUR_H_SHADER);
            const gaussianBlurVProgram = createProgram$3(gl, VERTEX_SHADER$2, GAUSSIAN_BLUR_V_SHADER);
            const tangentExtractProgram = createProgram$3(gl, VERTEX_SHADER$2, TANGENT_EXTRACT_SHADER);
            const tangentRefineProgram = createProgram$3(gl, VERTEX_SHADER$2, TANGENT_REFINE_SHADER);
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
                quadVAO,
                quadVBO,
            };
            return this.resources;
        }
        /**
         * Compute ETF using WebGL
         */
        static compute(input, config = {}, sigmaC) {
            const cfg = { ...DEFAULT_ETF_CONFIG, ...config };
            const { width, height } = input;
            const res = this.initResources(width, height);
            const { gl } = res;
            gl.viewport(0, 0, width, height);
            // Create input texture
            const inputTex = createTexture(gl, width, height, gl.R32F, gl.RED, input.data);
            // Create framebuffers for ping-pong
            const gradientFB = createFramebuffer$1(gl, width, height, gl.RGBA32F);
            const tensorFB = createFramebuffer$1(gl, width, height, gl.RGBA32F);
            const blurTempFB = createFramebuffer$1(gl, width, height, gl.RGBA32F);
            const blurOutputFB = createFramebuffer$1(gl, width, height, gl.RGBA32F);
            const tangentFB1 = createFramebuffer$1(gl, width, height, gl.RGBA32F);
            const tangentFB2 = createFramebuffer$1(gl, width, height, gl.RGBA32F);
            // Step 1: Compute gradients
            gl.bindFramebuffer(gl.FRAMEBUFFER, gradientFB.fb);
            gl.useProgram(res.gradientProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, inputTex);
            gl.uniform1i(gl.getUniformLocation(res.gradientProgram, 'u_input'), 0);
            gl.uniform2f(gl.getUniformLocation(res.gradientProgram, 'u_resolution'), width, height);
            drawQuad(gl, res.quadVAO);
            // Step 2: Build structure tensor
            gl.bindFramebuffer(gl.FRAMEBUFFER, tensorFB.fb);
            gl.useProgram(res.structureTensorProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, gradientFB.tex);
            gl.uniform1i(gl.getUniformLocation(res.structureTensorProgram, 'u_gradients'), 0);
            drawQuad(gl, res.quadVAO);
            // Step 3: Gaussian blur the structure tensor
            const smoothSigma = sigmaC ?? (cfg.kernelSize / 2.45);
            const radius = Math.min(16, Math.ceil(smoothSigma * 2.45)); // Cap at 16 for shader array limit
            const kernelSize = radius * 2 + 1;
            const kernel = generateGaussianKernel(smoothSigma, kernelSize);
            // Horizontal blur
            gl.bindFramebuffer(gl.FRAMEBUFFER, blurTempFB.fb);
            gl.useProgram(res.gaussianBlurHProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tensorFB.tex);
            gl.uniform1i(gl.getUniformLocation(res.gaussianBlurHProgram, 'u_input'), 0);
            gl.uniform2f(gl.getUniformLocation(res.gaussianBlurHProgram, 'u_resolution'), width, height);
            gl.uniform1fv(gl.getUniformLocation(res.gaussianBlurHProgram, 'u_kernel'), kernel);
            gl.uniform1i(gl.getUniformLocation(res.gaussianBlurHProgram, 'u_kernelSize'), kernelSize);
            gl.uniform1i(gl.getUniformLocation(res.gaussianBlurHProgram, 'u_radius'), radius);
            drawQuad(gl, res.quadVAO);
            // Vertical blur
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
            // Step 4: Extract initial tangent field
            gl.bindFramebuffer(gl.FRAMEBUFFER, tangentFB1.fb);
            gl.useProgram(res.tangentExtractProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, blurOutputFB.tex);
            gl.uniform1i(gl.getUniformLocation(res.tangentExtractProgram, 'u_tensor'), 0);
            drawQuad(gl, res.quadVAO);
            // Step 5: Refine tangent field iteratively (ping-pong between framebuffers)
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
            // Convert to Vec2 array
            const tangents = new Array(width * height);
            for (let i = 0; i < width * height; i++) {
                tangents[i] = {
                    x: pixels[i * 4],
                    y: pixels[i * 4 + 1],
                };
            }
            // Cleanup temporary resources
            gl.deleteTexture(inputTex);
            deleteFramebuffer(gl, gradientFB);
            deleteFramebuffer(gl, tensorFB);
            deleteFramebuffer(gl, blurTempFB);
            deleteFramebuffer(gl, blurOutputFB);
            deleteFramebuffer(gl, tangentFB1);
            deleteFramebuffer(gl, tangentFB2);
            return new EdgeTangentFlowWebGL(tangents, width, height);
        }
        /**
         * Visualize the flow field as a grayscale image
         */
        visualize() {
            const output = createChannelImage(this.width, this.height);
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    const idx = y * this.width + x;
                    const t = this.tangents[idx];
                    const angle = Math.atan2(t.y, t.x);
                    output.data[idx] = (angle + Math.PI) / (2 * Math.PI);
                }
            }
            return output;
        }
        /**
         * Cleanup WebGL resources (call when done with all ETF computations)
         */
        static dispose() {
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
    function generateGaussianKernel(sigma, size) {
        const kernel = new Float32Array(size);
        const center = Math.floor(size / 2);
        let sum = 0;
        for (let i = 0; i < size; i++) {
            const x = i - center;
            kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
            sum += kernel[i];
        }
        // Normalize
        for (let i = 0; i < size; i++) {
            kernel[i] /= sum;
        }
        return kernel;
    }

    /**
     * Edge Tangent Flow computation for FDoG
     *
     * The ETF represents the direction of edges at each pixel, computed from
     * the structure tensor of the image gradients.
     *
     * Based on Section 2.6 of Winnemöller et al. (2012) and
     * Kang et al. (2007) "Coherent Line Drawing"
     */
    /**
     * Edge Tangent Flow field implementation
     */
    let EdgeTangentFlow$1 = class EdgeTangentFlow {
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
            const output = createChannelImage(this.width, this.height);
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
                    const [r, g, b] = hsvToRgb$1(hue, saturation, value);
                    const i = idx * 4;
                    imageData.data[i] = r;
                    imageData.data[i + 1] = g;
                    imageData.data[i + 2] = b;
                    imageData.data[i + 3] = 255;
                }
            }
            return imageData;
        }
    };
    /**
     * Convert HSV to RGB
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
        // Kernel size based on paper's 2.45σ sampling rule
        const radius = Math.ceil(sigma * 2.45);
        const kernelSize = radius * 2 + 1;
        const kernel = generateGaussianKernel$2(sigma, kernelSize);
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
     * Unified Edge Tangent Flow that automatically selects the best implementation
     *
     * Preference order in 'auto' mode: WebGPU > WebGL > CPU. WebGPU compute is
     * inherently async (device acquisition + buffer readback both require
     * awaiting), so compute() is now async across the board — the WebGL and
     * CPU paths are still synchronous under the hood, but are wrapped so the
     * public API is consistent regardless of which implementation gets picked.
     */
    class EdgeTangentFlow {
        impl;
        width;
        height;
        constructor(impl) {
            this.impl = impl;
            this.width = impl.width;
            this.height = impl.height;
        }
        getTangent(x, y) {
            return this.impl.getTangent(x, y);
        }
        getTangentArray() {
            return this.impl.getTangentArray();
        }
        visualize() {
            return this.impl.visualize();
        }
        /**
         * Check if WebGPU acceleration is available
         *
         * Note: this is the same cheap synchronous check EdgeTangentFlowWebGPU
         * itself uses (navigator.gpu presence) — it doesn't guarantee an adapter
         * can actually be obtained. Use EdgeTangentFlowWebGPU.getUnsupportedReason()
         * for a more thorough (async) check if needed.
         */
        static isWebGPUSupported() {
            return EdgeTangentFlowWebGPU.isSupported();
        }
        /**
         * Check if WebGL acceleration is available
         */
        static isWebGLSupported() {
            return EdgeTangentFlowWebGL.isSupported();
        }
        /**
         * Compute ETF using the best available implementation
         *
         * @param input Grayscale image
         * @param config ETF configuration
         * @param sigmaC Structure tensor smoothing sigma
         * @param forceImpl Force a specific implementation ('cpu' | 'webgl' | 'webgpu' | 'auto')
         */
        static async compute(input, config = {}, sigmaC, forceImpl = 'auto') {
            if (forceImpl === 'webgpu') {
                if (!EdgeTangentFlowWebGPU.isSupported()) {
                    throw new Error('WebGPU not supported but webgpu implementation was forced');
                }
                console.log('[ETF] Using WebGPU implementation (forced)');
                const impl = await EdgeTangentFlowWebGPU.compute(input, config, sigmaC);
                return new EdgeTangentFlow(impl);
            }
            if (forceImpl === 'webgl') {
                if (!EdgeTangentFlowWebGL.isSupported()) {
                    throw new Error('WebGL not supported but webgl implementation was forced');
                }
                console.log('[ETF] Using WebGL implementation (forced)');
                const impl = EdgeTangentFlowWebGL.compute(input, config, sigmaC);
                return new EdgeTangentFlow(impl);
            }
            if (forceImpl === 'cpu') {
                console.log('[ETF] Using CPU implementation (forced)');
                const impl = EdgeTangentFlow$1.compute(input, config, sigmaC);
                return new EdgeTangentFlow(impl);
            }
            // 'auto': prefer WebGPU, then WebGL, then CPU. Each tier falls through
            // to the next on failure — WebGPU in particular can pass the cheap
            // isSupported() check but still fail at adapter/device acquisition
            // time, so that's guarded with a try/catch rather than trusted blindly.
            if (EdgeTangentFlowWebGPU.isSupported()) {
                try {
                    console.log('[ETF] Using WebGPU implementation');
                    const impl = await EdgeTangentFlowWebGPU.compute(input, config, sigmaC);
                    return new EdgeTangentFlow(impl);
                }
                catch (err) {
                    console.warn('[ETF] WebGPU implementation failed, falling back:', err);
                }
            }
            if (EdgeTangentFlowWebGL.isSupported()) {
                try {
                    console.log('[ETF] Using WebGL implementation');
                    const impl = EdgeTangentFlowWebGL.compute(input, config, sigmaC);
                    return new EdgeTangentFlow(impl);
                }
                catch (err) {
                    console.warn('[ETF] WebGL implementation failed, falling back:', err);
                }
            }
            console.log('[ETF] Using CPU implementation');
            const impl = EdgeTangentFlow$1.compute(input, config, sigmaC);
            return new EdgeTangentFlow(impl);
        }
        /**
         * Cleanup WebGPU and WebGL resources
         */
        static dispose() {
            EdgeTangentFlowWebGPU.dispose();
            EdgeTangentFlowWebGL.dispose();
        }
    }

    /**
     * Gradient-aligned blur for FDoG
     *
     * This applies blur perpendicular to the flow direction (across edges).
     * Used for the DoG computation in FDoG, where we want to blur across
     * edges but not along them.
     */
    class CPUGradientAlignedBlur extends BaseCPUBlur {
        flowField;
        config;
        constructor(flowField, config = {}) {
            super();
            this.flowField = flowField;
            this.config = { ...DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG, ...config };
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
            const output = createChannelImage(input.width, input.height);
            // Number of samples perpendicular to flow
            const halfSamples = Math.ceil(sigma * 2 / this.config.stepSize);
            const numSamples = halfSamples * 2 + 1;
            const weights = generateGaussianKernel$2(sigma, numSamples);
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

    /**
     * WebGL2-accelerated gradient-aligned blur for FDoG
     *
     * Runs the exact same perpendicular-to-flow sampling as
     * CPUGradientAlignedBlur, but as a single fullscreen-quad fragment shader
     * pass on the GPU instead of a per-pixel JS loop.
     *
     * ASSUMPTIONS (double check against your real types.ts):
     * - `FlowField` only exposes `getTangent(x, y): Vec2` — there's no bulk
     *   accessor. So we "bake" the perpendicular direction into an RG32F
     *   texture once per FlowField (cached; only rebaked when setFlowField()
     *   is called or the image dimensions change). If FlowField ever grows a
     *   bulk method (e.g. a Float32Array of tangents), swap bakeFlowTexture()
     *   to use it directly and skip the per-pixel getTangent() calls.
     * - `ChannelImage.data` is a single-channel Float32Array, row-major.
     * - `BlurStrategy` is `{ blur(input, sigma): Promise<ChannelImage> }`.
     *
     * NOTE ON THE TIMING NUMBERS:
     * WebGL submission (drawArrays) is async on the GPU timeline. The
     * "Draw call" log below only measures how long it took the JS thread to
     * *submit* the work — the driver doesn't actually block until something
     * forces a sync, which here is `readPixels`. So in practice most of the
     * real GPU time will show up under "Readback", not "Draw call". If you
     * need true GPU-side timing, add the EXT_disjoint_timer_query_webgl2
     * extension — happy to wire that in if these numbers don't add up.
     */
    // Must match the unrolled loop bound in FRAGMENT_SRC below.
    const MAX_SAMPLES$1 = 256;
    const VERTEX_SRC = `#version 300 es
layout(location = 0) in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;
    const FRAGMENT_SRC = `#version 300 es
precision highp float;

#define MAX_SAMPLES ${MAX_SAMPLES$1}

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
    class WebGLGradientAlignedBlur {
        flowField;
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
        constructor(flowField, config = {}) {
            this.flowField = flowField;
            this.config = { ...DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG, ...config };
            const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
            const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false });
            if (!gl) {
                throw new Error('[GradientAlignedBlur/WebGL] WebGL2 not available');
            }
            if (!gl.getExtension('EXT_color_buffer_float')) {
                throw new Error('[GradientAlignedBlur/WebGL] EXT_color_buffer_float not supported (required for R32F render targets)');
            }
            this.canvas = canvas;
            this.gl = gl;
            this.program = createProgram$2(gl, VERTEX_SRC, FRAGMENT_SRC);
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
        setupTextureParams(tex) {
            const gl = this.gl;
            gl.bindTexture(gl.TEXTURE_2D, tex);
            // NEAREST everywhere — we do bilinear manually in-shader via texelFetch,
            // so hardware filtering support for float textures is irrelevant here.
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
            const t0 = performance.now();
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
            console.log(`[GradientAlignedBlur/WebGL] Baked flow field texture (${width}x${height}): ${(performance.now() - t0).toFixed(2)}ms`);
        }
        async blur(input, sigma) {
            const tTotal = performance.now();
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
            if (Math.ceil((sigma * 2) / this.config.stepSize) > MAX_SAMPLES$1 - 1) {
                console.warn(`[GradientAlignedBlur/WebGL] halfSamples clamped to ${MAX_SAMPLES$1 - 1} (sigma=${sigma} wanted more); kernel truncated. Raise MAX_SAMPLES if this matters.`);
            }
            const numSamples = halfSamples * 2 + 1;
            const weights = generateGaussianKernel$2(sigma, numSamples);
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
            const tDraw = performance.now();
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
            gl.bindVertexArray(this.vao);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            console.log(`[GradientAlignedBlur/WebGL] Draw call submit (JS-side only, GPU work is async — see note at top of file): ${(performance.now() - tDraw).toFixed(2)}ms`);
            const tReadback = performance.now();
            const output = createChannelImage(width, height);
            gl.readPixels(0, 0, width, height, gl.RED, gl.FLOAT, output.data);
            console.log(`[GradientAlignedBlur/WebGL] Readback (this is where the GPU wait actually happens): ${(performance.now() - tReadback).toFixed(2)}ms`);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            console.log(`[GradientAlignedBlur/WebGL] blur() total (sigma=${sigma.toFixed(2)}, halfSamples=${halfSamples}): ${(performance.now() - tTotal).toFixed(2)}ms`);
            return output;
        }
    }

    /**
     * WebGPU-accelerated gradient-aligned blur for FDoG
     *
     * Compute-shader version of the same perpendicular-to-flow sampling as
     * CPUGradientAlignedBlur / WebGLGradientAlignedBlur. Prefer this backend
     * when available — no readback-forced sync via drawing, explicit control
     * over the copy timeline, and generally faster on the same hardware.
     *
     * ASSUMPTIONS — same as the WebGL file:
     * - `FlowField` only exposes `getTangent(x, y): Vec2`; we bake perpendicular
     *   direction into an rg32float texture once per FlowField instance.
     * - `ChannelImage.data` is a single-channel Float32Array, row-major.
     *
     * TYPES: this file assumes `@webgpu/types` is installed (or `lib.dom` in a
     * recent TS/tsconfig that includes WebGPU types). If GPUDevice/GPUBuffer
     * etc. aren't recognized, add `@webgpu/types` as a devDependency and either
     * add it to tsconfig `types`, or drop a `/// <reference types="@webgpu/types" />`
     * at the top of this file.
     *
     * NOTE ON TIMING:
     * Like the WebGL version, `queue.submit()` doesn't block — the actual GPU
     * wait happens at `mapAsync()`. So "Dispatch" below measures submission
     * only; "Readback" is where the real cost will show up. For true GPU-side
     * timing, add a `GPUQuerySet` with 'timestamp' queries around the compute
     * pass (needs the 'timestamp-query' feature) — can wire that in if you
     * want harder numbers than JS-side wall time.
     */
    const MAX_SAMPLES = 256;
    const WORKGROUP_SIZE = 8;
    const SHADER_SRC = `
struct Params {
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
@group(0) @binding(1) var<storage, read> weights: array<f32, ${MAX_SAMPLES}>;
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

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
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
}
`;
    class WebGPUGradientAlignedBlur {
        flowField;
        config;
        device;
        pipeline;
        // NOTE ON CONCURRENCY:
        // `blur()` is safe to call concurrently on the same instance (e.g. two
        // different sigmas via Promise.all). To make that safe, every resource
        // that is written-to-then-read-back per call (input texture, output
        // buffer, readback buffer, params buffer, weights buffer, bind group) is
        // now allocated fresh *inside* blur() and destroyed when that call is
        // done — no shared mutable GPU state between concurrent invocations.
        // Only the compute pipeline (immutable after creation) and the flow
        // texture (read-only, cached by dimensions) remain instance-level, and
        // the flow texture bake is guarded by `flowBakePromise` so concurrent
        // calls with the same dimensions share one bake instead of racing.
        flowTexture = null;
        flowFieldWidth = 0;
        flowFieldHeight = 0;
        flowDirty = true;
        flowBakePromise = null;
        // Bytes we're willing to put in a single GPU buffer for one tile, well
        // under whatever the device actually supports (see `create()`). Large
        // images are processed in row-band tiles bounded by this so memory use
        // stays flat regardless of image size — this is what prevents the
        // crash on big images/concurrent calls.
        maxTileBytes = 0;
        // CPU-side cap on how many rows of flow-field data we build into a
        // Float32Array at once, so baking the flow texture for a huge image
        // doesn't itself blow up JS heap before anything even reaches the GPU.
        static CPU_BAKE_ROWS_PER_CHUNK = 512;
        static TILE_MEMORY_SAFETY_FACTOR = 0.5;
        constructor(flowField, device, config) {
            this.flowField = flowField;
            this.device = device;
            this.config = { ...DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG, ...config };
            this.initPipeline();
            // maxBufferSize / maxStorageBufferBindingSize are usually the binding
            // constraint that bites first on large images (commonly 256MB / 128MB
            // by default, even when the adapter can do far more). Cap tile size to
            // half of whichever is smaller as a safety margin — driver-reported
            // limits are the ceiling, not a size it's safe to actually hit.
            const limits = this.device.limits;
            this.maxTileBytes = Math.max(WORKGROUP_SIZE * 4, // never go below one row's worth of data
            Math.floor(Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize) *
                WebGPUGradientAlignedBlur.TILE_MEMORY_SAFETY_FACTOR));
            // Surface GPU-side failures (e.g. a validation error from a size that
            // slipped past our checks) as visible console errors instead of a
            // silent hang or an opaque tab crash.
            this.device.addEventListener('uncapturederror', (event) => {
                console.error('[GradientAlignedBlur/WebGPU] uncaptured GPU error:', event.error?.message ?? event.error);
            });
        }
        /** WebGPU device creation is async, so use this instead of `new`. */
        static async create(flowField, config = {}) {
            if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
                throw new Error('[GradientAlignedBlur/WebGPU] navigator.gpu unavailable');
            }
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                throw new Error('[GradientAlignedBlur/WebGPU] No adapter available');
            }
            // Explicitly request the adapter's actual max limits rather than
            // accepting the (often much lower) spec-minimum defaults — e.g. the
            // default maxBufferSize/maxStorageBufferBindingSize are commonly
            // 256MB/128MB, but many adapters support several times that. Getting
            // this headroom up front means fewer images need tiling at all.
            const device = await adapter.requestDevice({
                requiredLimits: {
                    maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
                },
            });
            return new WebGPUGradientAlignedBlur(flowField, device, config);
        }
        initPipeline() {
            const module = this.device.createShaderModule({ code: SHADER_SRC });
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
         * NOTE: only safe to call once no `blur()` calls are in flight — it
         * destroys the device itself, which would invalidate any in-progress
         * GPU work. Per-call buffers/textures created inside blur() are already
         * cleaned up in their own try/finally, so there's nothing else to
         * release here besides the flow texture and the device.
         */
        dispose() {
            this.flowTexture?.destroy();
            this.device.destroy();
        }
        bakeFlowTexture(width, height) {
            this.assertWithinTextureLimits(width, height);
            const t0 = performance.now();
            const newTexture = this.device.createTexture({
                size: [width, height],
                format: 'rg32float',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
            // Build+upload in row-chunks rather than one Float32Array(width*height*2)
            // for the whole image — for a large image that single array can itself
            // be gigabytes of JS heap before any GPU work happens.
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
            // Swap in the new texture only after it's fully written, and only
            // destroy the old one after the swap so a concurrent blur() call that
            // already grabbed a reference to `oldTexture` for an in-flight dispatch
            // isn't left pointing at a destroyed resource. (There's still a narrow
            // window if a call reads `this.flowTexture` between the old texture's
            // last use and here — acceptable for a texture that only changes when
            // setFlowField() is called, which is rare relative to blur() calls
            // with a stable flow field.)
            this.flowTexture = newTexture;
            oldTexture?.destroy();
            this.flowFieldWidth = width;
            this.flowFieldHeight = height;
            this.flowDirty = false;
            console.log(`[GradientAlignedBlur/WebGPU] Baked flow field texture (${width}x${height}): ${(performance.now() - t0).toFixed(2)}ms`);
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
         * same image) instead of scaling linearly with width*height — see the
         * note above `maxTileBytes` for why. The input/flow textures are still
         * one full-image texture each; if width or height exceeds the device's
         * maxTextureDimension2D, `getFlowTexture`/this method throw a clear
         * error rather than silently corrupting or crashing (see
         * `assertWithinTextureLimits`).
         */
        async blur(input, sigma) {
            const tTotal = performance.now();
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
            const weights = generateGaussianKernel$2(sigma, numSamples);
            const paddedWeights = new Float32Array(MAX_SAMPLES);
            paddedWeights.set(weights);
            // Row-band tile plan. Only the output/readback buffers scale with
            // tile size — the input/flow textures below are still whole-image.
            const bytesPerRow = width * 4;
            const rowsPerTile = Math.max(1, Math.min(height, Math.floor(this.maxTileBytes / bytesPerRow)));
            const tileCount = Math.ceil(height / rowsPerTile);
            if (tileCount > 1) {
                console.log(`[GradientAlignedBlur/WebGPU] Image ${width}x${height} exceeds safe single-buffer size; ` +
                    `processing in ${tileCount} row-band tiles of ~${rowsPerTile} rows each.`);
            }
            // Per-call GPU resources — never shared across concurrent blur() calls.
            // Input/flow textures are whole-image (bounded by maxTextureDimension2D,
            // checked above); output/readback buffers are sized to one tile only
            // and reused sequentially across tiles, so peak memory here is
            // O(tileRows * width) rather than O(height * width).
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
                const tUpload = performance.now();
                this.device.queue.writeTexture({ texture: inputTexture }, input.data, { bytesPerRow, rowsPerImage: height }, { width, height });
                this.device.queue.writeBuffer(weightsBuffer, 0, paddedWeights);
                console.log(`[GradientAlignedBlur/WebGPU] Upload (texture + weights, submit only): ${(performance.now() - tUpload).toFixed(2)}ms`);
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
                const output = createChannelImage(width, height);
                const tTiles = performance.now();
                // Tiles are processed sequentially (dispatch -> readback -> next)
                // rather than pipelined, since outputBuffer/readBuffer are reused
                // across iterations — that reuse is exactly what keeps memory
                // bounded, at the cost of some overlap opportunity between tiles.
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
                    pass.dispatchWorkgroups(Math.ceil(width / WORKGROUP_SIZE), Math.ceil(tileHeight / WORKGROUP_SIZE));
                    pass.end();
                    encoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, tileHeight * bytesPerRow);
                    this.device.queue.submit([encoder.finish()]);
                    await readBuffer.mapAsync(GPUMapMode.READ, 0, tileHeight * bytesPerRow);
                    const mapped = readBuffer.getMappedRange(0, tileHeight * bytesPerRow);
                    output.data.set(new Float32Array(mapped), rowOffset * width);
                    readBuffer.unmap();
                }
                console.log(`[GradientAlignedBlur/WebGPU] Dispatch + readback across ${tileCount} tile(s): ${(performance.now() - tTiles).toFixed(2)}ms`);
                console.log(`[GradientAlignedBlur/WebGPU] blur() total (sigma=${sigma.toFixed(2)}, halfSamples=${halfSamples}): ${(performance.now() - tTotal).toFixed(2)}ms`);
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
        flowField;
        config;
        instance;
        backend = 'cpu';
        initPromise;
        constructor(flowField, config = {}) {
            this.flowField = flowField;
            this.config = config;
            // Always start with a working CPU instance so the object is valid the
            // instant it's constructed. blur() awaits initPromise before running,
            // so no work actually happens on this instance unless backend upgrade
            // fails entirely — it's a fallback, not a "first frame is slow" thing.
            this.instance = new CPUGradientAlignedBlur(flowField, config);
            this.backend = 'cpu';
            this.initPromise = this.upgradeBackend();
        }
        /**
         * Preferred construction path — resolves only once backend detection has
         * finished, so `getBackend()` is meaningful immediately.
         */
        static async create(flowField, config = {}) {
            const instance = new GradientAlignedBlur(flowField, config);
            await instance.ready();
            return instance;
        }
        /** Resolves once GPU backend detection/initialization has settled (including CPU fallback). */
        ready() {
            return this.initPromise;
        }
        getBackend() {
            return this.backend;
        }
        async upgradeBackend() {
            const t0 = performance.now();
            if (await isWebGPUSupported()) {
                try {
                    const gpuInstance = await WebGPUGradientAlignedBlur.create(this.flowField, this.config);
                    this.instance.dispose?.();
                    this.instance = gpuInstance;
                    this.backend = 'webgpu';
                    console.log(`[GradientAlignedBlur] Using WebGPU backend (init: ${(performance.now() - t0).toFixed(2)}ms)`);
                    return;
                }
                catch (err) {
                    console.warn('[GradientAlignedBlur] WebGPU init failed, falling back:', err);
                }
            }
            if (isWebGLComputeSupported()) {
                try {
                    const glInstance = new WebGLGradientAlignedBlur(this.flowField, this.config);
                    this.instance.dispose?.();
                    this.instance = glInstance;
                    this.backend = 'webgl';
                    console.log(`[GradientAlignedBlur] Using WebGL2 backend (init: ${(performance.now() - t0).toFixed(2)}ms)`);
                    return;
                }
                catch (err) {
                    console.warn('[GradientAlignedBlur] WebGL2 init failed, falling back to CPU:', err);
                }
            }
            console.log(`[GradientAlignedBlur] Using CPU backend (fallback) (detection: ${(performance.now() - t0).toFixed(2)}ms)`);
        }
        async blur(input, sigma) {
            await this.initPromise;
            return this.instance.blur(input, sigma);
        }
        setFlowField(flowField) {
            this.flowField = flowField;
            this.instance.setFlowField?.(flowField);
        }
        dispose() {
            this.instance.dispose?.();
        }
    }

    const DEFAULT_FLOW_CONFIG = {
        kernelSizeMultiplier: 6,
        stepSize: 1.0,
    };
    class CPUFlowGuidedBlur extends BaseCPUBlur {
        flowField;
        config;
        constructor(flowField, config = {}) {
            super();
            this.flowField = flowField;
            this.config = { ...DEFAULT_FLOW_CONFIG, ...config };
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
            const output = createChannelImage(input.width, input.height);
            // Number of samples along the flow line
            // Paper samples at 2× sigma in each direction
            const halfSamples = Math.ceil(sigma * 2 / this.config.stepSize);
            const numSamples = halfSamples * 2 + 1;
            // Generate 1D Gaussian weights
            const weights = generateGaussianKernel$2(sigma, numSamples);
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
    /**
     * Fragment shader for flow-guided blur (WebGL2)
     * Uses line integral convolution along edge tangent directions
     */
    const FLOW_BLUR_SHADER = `#version 300 es
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
    /**
     * Vertex shader for WebGL2 - simple fullscreen quad
     */
    const VERTEX_SHADER$1 = `#version 300 es
  in vec2 a_position;
  in vec2 a_texCoord;
  out vec2 v_texCoord;
  
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;
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
    class WebGLFlowGuidedBlur extends BaseWebGLBlur {
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
            const program = createProgram$1(gl, VERTEX_SHADER$1, FLOW_BLUR_SHADER);
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
            const kernel = generateGaussianKernel$2(sigma, kernelSize);
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
            const output = createChannelImage(width, height);
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
    /**
     * WebGPU compute shader for flow-guided blur
     */
    const FLOW_BLUR_WGSL = `
  struct Params {
    width: u32,
    height: u32,
    kernelSize: u32,
    _padding: u32,
  }
  
  @group(0) @binding(0) var<uniform> params: Params;
  @group(0) @binding(1) var<storage, read> kernel: array<f32>;
  @group(0) @binding(2) var<storage, read> input: array<f32>;
  @group(0) @binding(3) var<storage, read> flowField: array<vec2<f32>>;
  @group(0) @binding(4) var<storage, read_write> output: array<f32>;
  
  fn sampleBilinear(x: f32, y: f32) -> f32 {
    let x0 = u32(floor(x));
    let y0 = u32(floor(y));
    let x1 = min(x0 + 1u, params.width - 1u);
    let y1 = min(y0 + 1u, params.height - 1u);
    
    let fx = x - floor(x);
    let fy = y - floor(y);
    
    let v00 = input[x0 + y0 * params.width];
    let v10 = input[x1 + y0 * params.width];
    let v01 = input[x0 + y1 * params.width];
    let v11 = input[x1 + y1 * params.width];
    
    return v00 * (1.0 - fx) * (1.0 - fy) +
           v10 * fx * (1.0 - fy) +
           v01 * (1.0 - fx) * fy +
           v11 * fx * fy;
  }
  
  fn getFlow(x: f32, y: f32) -> vec2<f32> {
    let cx = clamp(u32(round(x)), 0u, params.width - 1u);
    let cy = clamp(u32(round(y)), 0u, params.height - 1u);
    return flowField[cx + cy * params.width];
  }
  
  @compute @workgroup_size(16, 16)
  fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
      return;
    }
    
    let halfKernel = i32(params.kernelSize) / 2;
    var sum: f32 = 0.0;
    var weightSum: f32 = 0.0;
    
    // Sample in positive flow direction
    var px: f32 = f32(x);
    var py: f32 = f32(y);
    for (var i: i32 = halfKernel; i < i32(params.kernelSize); i++) {
      sum += sampleBilinear(px, py) * kernel[i];
      weightSum += kernel[i];
      
      let tangent = getFlow(px, py);
      px += tangent.x;
      py += tangent.y;
    }
    
    // Sample in negative flow direction
    px = f32(x);
    py = f32(y);
    for (var i: i32 = halfKernel - 1; i >= 0; i--) {
      let tangent = getFlow(px, py);
      px -= tangent.x;
      py -= tangent.y;
      
      sum += sampleBilinear(px, py) * kernel[i];
      weightSum += kernel[i];
    }
    
    if (weightSum > 0.0) {
      output[x + y * params.width] = sum / weightSum;
    } else {
      output[x + y * params.width] = 0.0;
    }
  }
`;
    const DEFAULT_WEBGPU_CONFIG = {
        kernelSizeMultiplier: 6,
        maxKernelSize: 127,
    };
    /**
     * WebGPU-accelerated flow-guided blur
     */
    class WebGPUFlowGuidedBlur extends BaseWebGPUBlur {
        config;
        flowField;
        resources = null;
        // Buffers
        paramsBuffer = null;
        kernelBuffer = null;
        inputBuffer = null;
        flowBuffer = null;
        outputBuffer = null;
        stagingBuffer = null;
        currentBufferSize = 0;
        currentKernelSize = 0;
        constructor(flowField, config = {}) {
            super();
            this.flowField = flowField;
            this.config = { ...DEFAULT_WEBGPU_CONFIG, ...config };
        }
        async initResources() {
            if (this.resources)
                return this.resources;
            const device = await WebGPUFlowGuidedBlur.getWebGPUDevice();
            if (!device) {
                throw new Error('WebGPU device not available');
            }
            // Flow blur needs 5 bindings
            const flowBindGroupLayout = device.createBindGroupLayout({
                entries: [
                    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                    { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                    { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                ],
            });
            const pipelineLayout = device.createPipelineLayout({
                bindGroupLayouts: [flowBindGroupLayout],
            });
            const flowPipeline = device.createComputePipeline({
                layout: pipelineLayout,
                compute: {
                    module: device.createShaderModule({ code: FLOW_BLUR_WGSL }),
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
        ensureBuffers(device, width, height, kernelSize) {
            const pixelCount = width * height;
            const bufferSize = pixelCount * 4;
            const flowBufferSize = pixelCount * 8; // vec2<f32> per pixel
            if (this.currentBufferSize < bufferSize) {
                this.inputBuffer?.destroy();
                this.flowBuffer?.destroy();
                this.outputBuffer?.destroy();
                this.stagingBuffer?.destroy();
                this.inputBuffer = device.createBuffer({
                    size: bufferSize,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                });
                this.flowBuffer = device.createBuffer({
                    size: flowBufferSize,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                });
                this.outputBuffer = device.createBuffer({
                    size: bufferSize,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
                });
                this.stagingBuffer = device.createBuffer({
                    size: bufferSize,
                    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
                });
                this.currentBufferSize = bufferSize;
                // Upload flow field
                const flowData = new Float32Array(pixelCount * 2);
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const idx = (y * width + x) * 2;
                        const tangent = this.flowField.getTangent(x, y);
                        flowData[idx] = tangent.x;
                        flowData[idx + 1] = tangent.y;
                    }
                }
                device.queue.writeBuffer(this.flowBuffer, 0, flowData);
            }
            if (this.currentKernelSize < kernelSize) {
                this.kernelBuffer?.destroy();
                this.kernelBuffer = device.createBuffer({
                    size: kernelSize * 4,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                });
                this.currentKernelSize = kernelSize;
            }
            if (!this.paramsBuffer) {
                this.paramsBuffer = device.createBuffer({
                    size: 16,
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                });
            }
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
            const { device, flowPipeline, flowBindGroupLayout } = await this.initResources();
            const { width, height } = input;
            const pixelCount = width * height;
            const kernelSize = Math.min(this.config.maxKernelSize, Math.max(3, Math.floor(sigma * this.config.kernelSizeMultiplier) | 1));
            const kernel = generateGaussianKernel$2(sigma, kernelSize);
            this.ensureBuffers(device, width, height, kernelSize);
            device.queue.writeBuffer(this.paramsBuffer, 0, new Uint32Array([width, height, kernelSize, 0]));
            device.queue.writeBuffer(this.kernelBuffer, 0, new Float32Array(kernel));
            device.queue.writeBuffer(this.inputBuffer, 0, new Float32Array(input.data));
            const bindGroup = device.createBindGroup({
                layout: flowBindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.paramsBuffer } },
                    { binding: 1, resource: { buffer: this.kernelBuffer } },
                    { binding: 2, resource: { buffer: this.inputBuffer } },
                    { binding: 3, resource: { buffer: this.flowBuffer } },
                    { binding: 4, resource: { buffer: this.outputBuffer } },
                ],
            });
            const workgroupsX = Math.ceil(width / 16);
            const workgroupsY = Math.ceil(height / 16);
            const commandEncoder = device.createCommandEncoder();
            const computePass = commandEncoder.beginComputePass();
            computePass.setPipeline(flowPipeline);
            computePass.setBindGroup(0, bindGroup);
            computePass.dispatchWorkgroups(workgroupsX, workgroupsY);
            computePass.end();
            commandEncoder.copyBufferToBuffer(this.outputBuffer, 0, this.stagingBuffer, 0, pixelCount * 4);
            device.queue.submit([commandEncoder.finish()]);
            await this.stagingBuffer.mapAsync(GPUMapMode.READ);
            const resultData = new Float32Array(this.stagingBuffer.getMappedRange().slice(0));
            this.stagingBuffer.unmap();
            return {
                data: resultData,
                width,
                height,
            };
        }
        dispose() {
            this.paramsBuffer?.destroy();
            this.kernelBuffer?.destroy();
            this.inputBuffer?.destroy();
            this.flowBuffer?.destroy();
            this.outputBuffer?.destroy();
            this.stagingBuffer?.destroy();
            this.paramsBuffer = null;
            this.kernelBuffer = null;
            this.inputBuffer = null;
            this.flowBuffer = null;
            this.outputBuffer = null;
            this.stagingBuffer = null;
            this.currentBufferSize = 0;
            this.currentKernelSize = 0;
            this.resources = null;
        }
    }
    class FlowGuidedBlur {
        instance;
        constructor(flowField, config = {}) {
            if (WebGPUFlowGuidedBlur.isSupported()) {
                this.instance = new WebGPUFlowGuidedBlur(flowField, config);
            }
            else if (WebGLFlowGuidedBlur.isSupported()) {
                this.instance = new WebGLFlowGuidedBlur(flowField, config);
            }
            else {
                this.instance = new CPUFlowGuidedBlur(flowField, config);
            }
        }
        dispose() {
            this.instance.dispose?.();
        }
        async blur(input, sigma) {
            return this.instance.blur(input, sigma);
        }
        /**
         * Update the flow field (e.g., when processing a new image)
         */
        setFlowField(flowField) {
            this.instance.setFlowField(flowField);
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
     * - σc: Structure tensor smoothing (controls ETF smoothness)
     * - σe: Edge detection sigma (controls edge width)
     * - σm: Flow-aligned smoothing (controls line coherence)
     * - σa: Anti-aliasing sigma (optional post-processing)
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
            const timings = {};
            const t0 = performance.now();
            // Step 1: Compute Edge Tangent Flow
            const etfStart = performance.now();
            const etf = await EdgeTangentFlow.compute(input, {
                iterations: DEFAULT_ETF_CONFIG.iterations,
                kernelSize: Math.ceil(params.sigmaC * 2.45) * 2 + 1,
            }, params.sigmaC);
            timings.etf = performance.now() - etfStart;
            const gradientBlur = new GradientAlignedBlur(etf);
            const processor = new DoGProcessor(gradientBlur, params);
            // Step 4: Process image (DoG + threshold)
            const dogStart = performance.now();
            let result = await processor.process(input);
            timings.dogProcess = performance.now() - dogStart;
            processor.dispose();
            const flowBlur = new FlowGuidedBlur(etf);
            // Step 5: Flow-aligned smoothing
            if (params.sigmaM > 0) {
                const smoothStart = performance.now();
                result = await flowBlur.blur(result, params.sigmaM);
                timings.flowSmooth = performance.now() - smoothStart;
            }
            // Step 6: Anti-aliasing
            if (params.sigmaA > 0) {
                const aaStart = performance.now();
                result = await flowBlur.blur(result, params.sigmaA);
                timings.antiAlias = performance.now() - aaStart;
            }
            flowBlur.dispose();
            const etfDisposeStart = performance.now();
            EdgeTangentFlow.dispose();
            timings.etfDispose = performance.now() - etfDisposeStart;
            timings.total = performance.now() - t0;
            console.debug('[FDoG] timings (ms):', timings);
            return result;
        }
        /**
         * Process with more control over individual stages
         */
        async processDetailed(input, overrides = {}) {
            const params = { ...this.config, ...overrides };
            // Compute ETF
            const etf = await EdgeTangentFlow.compute(input, {
                iterations: DEFAULT_ETF_CONFIG.iterations,
                kernelSize: Math.ceil(params.sigmaC * 2.45) * 2 + 1,
            }, params.sigmaC);
            // Create blur strategies
            const gradientBlur = new GradientAlignedBlur(etf);
            const processor = new DoGProcessor(gradientBlur, params);
            // Get intermediate results
            const [sharpened, thresholded] = await Promise.all([
                processor.processNoThreshold(input),
                processor.process(input)
            ]);
            // Flow-aligned smoothing
            let smoothed = thresholded;
            if (params.sigmaM > 0) {
                const flowBlur = new FlowGuidedBlur(etf);
                smoothed = await flowBlur.blur(thresholded, params.sigmaM);
                flowBlur.dispose();
            }
            // Anti-aliasing
            let result = smoothed;
            if (params.sigmaA > 0) {
                const flowCls = FlowGuidedBlur;
                const aaBlur = new flowCls(etf);
                result = await aaBlur.blur(smoothed, params.sigmaA);
                aaBlur.dispose();
            }
            EdgeTangentFlow.dispose();
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
            const gradientBlur = new GradientAlignedBlur(etf);
            const processor = new DoGProcessor(gradientBlur, params);
            let result = await processor.process(input);
            processor.dispose();
            const flowCls = FlowGuidedBlur;
            if (params.sigmaM > 0) {
                const flowBlur = new flowCls(etf);
                result = await flowBlur.blur(result, params.sigmaM);
                flowBlur.dispose();
            }
            if (params.sigmaA > 0) {
                const aaBlur = new flowCls(etf);
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
            const flowCls = FlowGuidedBlur;
            const aaBlur = new flowCls(etf);
            const result = aaBlur.blur(input, sigma);
            aaBlur.dispose();
            EdgeTangentFlow.dispose();
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
            this.blurStrategy = new IsotropicBlur({
                kernelSizeMultiplier: this.config.kernelSizeMultiplier,
            });
        }
        dispose() {
            this.blurStrategy.dispose();
        }
        /**
         * Process a grayscale image through the ADoG pipeline.
         *
         * Note on the DoGImplementation interface: this method's `overrides` is
         * typed against Partial<ADoGConfig> (a superset of DoGConfig), which
         * satisfies DoGImplementation's Partial<DoGConfig> parameter type via
         * TypeScript's bivariant method-parameter checking. A caller holding this
         * instance through the DoGImplementation interface type (rather than the
         * concrete ADoG type) can only type-check overrides for fields that exist
         * on DoGConfig (sigma, k, epsilon, phi, ...) -- tau/s/noiseScaleC are only
         * overridable when the caller has a concrete ADoG reference. No data is
         * lost; this only affects what's type-checkable through the narrower view.
         */
        async process(input, overrides = {}) {
            const { result } = await this.processDetailed(input, overrides);
            return result;
        }
        async processDetailed(input, overrides = {}) {
            const params = { ...this.config, ...overrides };
            // Step 1 (Eq. 6): tone-adaptive noise injection, applied before blurring.
            // Skipped entirely when noiseScaleC is 0 (noise injection is optional --
            // see Figs. 7 vs 8 in the paper).
            const noisyInput = params.noiseScaleC > 0
                ? this.injectAdaptiveNoise(input, params.noiseScaleC, params.s)
                : input;
            // Step 2: two isotropic Gaussian blurs -- sigma = sigmaC, k*sigmaC = sigmaS
            const [blurC, blurS] = await Promise.all([
                this.blurStrategy.blur(noisyInput, params.sigma),
                this.blurStrategy.blur(noisyInput, params.sigma * params.k),
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
        setConfig(config) {
            if (config.kernelSizeMultiplier !== undefined) {
                this.blurStrategy = new IsotropicBlur({ kernelSizeMultiplier: config.kernelSizeMultiplier });
            }
            this.config = { ...this.config, ...config };
        }
        /** Eq. (5): rho(x) = tau + (1 - tau) * (1 - tanh(s * I(x))) */
        computeRhoMap(input, tau, s) {
            const output = createChannelImage(input.width, input.height);
            for (let i = 0; i < input.data.length; i++) {
                output.data[i] = tau + (1 - tau) * (1 - Math.tanh(s * input.data[i]));
            }
            return output;
        }
        /** Eq. (6): sigma(x) = c * (1 - tanh(s * I(x))); sampled noise ~ N(0,1) * sigma(x) added to I(x) */
        injectAdaptiveNoise(input, c, s) {
            const output = createChannelImage(input.width, input.height);
            for (let i = 0; i < input.data.length; i++) {
                const sigma = c * (1 - Math.tanh(s * input.data[i]));
                output.data[i] = input.data[i] + sigma * gaussianSample();
            }
            return output;
        }
        /** Eq. (3)/(4): ADoG(x) = G_sigmaC(x) - rho(x) * G_sigmaS(x) */
        computeWeightedDoG(blurC, blurS, rho) {
            const output = createChannelImage(blurC.width, blurC.height);
            for (let i = 0; i < blurC.data.length; i++) {
                output.data[i] = blurC.data[i] - rho.data[i] * blurS.data[i];
            }
            return output;
        }
        /** Standard (non-adaptive) DoG: G_sigmaC(x) - G_sigmaS(x), i.e. rho == 1 everywhere */
        computeUnweightedDoG(blurC, blurS) {
            const output = createChannelImage(blurC.width, blurC.height);
            for (let i = 0; i < blurC.data.length; i++) {
                output.data[i] = blurC.data[i] - blurS.data[i];
            }
            return output;
        }
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
     * Convenience function for one-shot HDoG processing, matching xdog()/fdog()
     * in dog.ts and adog() in adog.ts
     */
    async function hdog(input, config = {}) {
        const processor = new HDoG(config);
        const result = await processor.process(input);
        processor.dispose();
        return result;
    }

    var index$3 = /*#__PURE__*/Object.freeze({
        __proto__: null,
        ADOG_PARAM_RANGES: ADOG_PARAM_RANGES,
        ADOG_STYLE_PRESETS: ADOG_STYLE_PRESETS,
        ADoG: ADoG,
        DEFAULT_ADOG_CONFIG: DEFAULT_ADOG_CONFIG,
        DEFAULT_DOG_CONFIG: DEFAULT_DOG_CONFIG,
        DEFAULT_FDOG_CONFIG: DEFAULT_FDOG_CONFIG,
        DEFAULT_HDOG_CONFIG: DEFAULT_HDOG_CONFIG,
        DOG_PARAM_RANGES: DOG_PARAM_RANGES,
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

    var index$2 = /*#__PURE__*/Object.freeze({
        __proto__: null,
        CPUFlowGuidedBlur: CPUFlowGuidedBlur,
        CPUIsotropicBlur: CPUIsotropicBlur,
        FlowGuidedBlur: FlowGuidedBlur,
        GradientAlignedBlur: GradientAlignedBlur,
        IsotropicBlur: IsotropicBlur,
        WebGLFlowGuidedBlur: WebGLFlowGuidedBlur,
        WebGLIsotropicBlur: WebGLIsotropicBlur,
        WebGPUFlowGuidedBlur: WebGPUFlowGuidedBlur,
        WebGPUIsotropicBlur: WebGPUIsotropicBlur
    });

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

    /**
     * WebGL-Accelerated Preprocessing Module for XDoG/FDoG
     *
     * High-performance GPU implementations of image preprocessing filters.
     * Achieves 50-100x speedup over CPU implementations for large images.
     *
     * Filters included:
     * - Bilateral Filter (edge-preserving smoothing)
     * - Median Filter (noise removal) - approximated via weighted histogram
     * - Kuwahara Filter (painterly effect)
     * - Gaussian Blur (separable, very fast)
     * - Contrast Enhancement
     * - Quantization
     *
     */
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
    const BILATERAL_FRAG = `#version 300 es
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
}
`;
    class BilateralFilterWebGL {
        config;
        constructor(config = {}) {
            this.config = { ...DEFAULT_BILATERAL_CONFIG$1, ...config };
        }
        process(input) {
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
            const program = createProgram(BILATERAL_FRAG, 'bilateral');
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
        }
    }
    // ============================================================================
    // GAUSSIAN BLUR - Separable WebGL Implementation (Very Fast)
    // ============================================================================
    const GAUSSIAN_H_FRAG = `#version 300 es
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
}
`;
    const GAUSSIAN_V_FRAG = `#version 300 es
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
}
`;
    class GaussianBlurWebGL {
        sigma;
        constructor(sigma = 1.0) {
            this.sigma = sigma;
        }
        process(input) {
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
            const hProgram = createProgram(GAUSSIAN_H_FRAG, 'gaussianH');
            const vProgram = createProgram(GAUSSIAN_V_FRAG, 'gaussianV');
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
        }
    }
    // ============================================================================
    // MEDIAN FILTER - WebGL Approximation using Weighted Histogram
    // ============================================================================
    // True median requires sorting which isn't efficient in shaders.
    // We use a weighted percentile approximation that's very close to median.
    const MEDIAN_FRAG = `#version 300 es
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
}
`;
    // For small radius, use direct sorting approach (more accurate)
    const MEDIAN_SMALL_FRAG = `#version 300 es
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
}
`;
    class MedianFilterWebGL {
        config;
        constructor(config = {}) {
            this.config = { ...DEFAULT_MEDIAN_CONFIG$1, ...config };
        }
        process(input) {
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
            // Use exact sorting for small kernels, histogram for large
            const shaderSource = radius <= 2 ? MEDIAN_SMALL_FRAG : MEDIAN_FRAG;
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
        }
    }
    // ============================================================================
    // KUWAHARA FILTER - WebGL Implementation
    // ============================================================================
    const KUWAHARA_FRAG = `#version 300 es
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
}
`;
    class KuwaharaFilterWebGL {
        config;
        constructor(config = {}) {
            this.config = { ...DEFAULT_KUWAHARA_CONFIG$1, ...config };
        }
        process(input) {
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
            const program = createProgram(KUWAHARA_FRAG, 'kuwahara');
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
        }
    }
    // ============================================================================
    // CONTRAST ENHANCEMENT - WebGL Implementation
    // ============================================================================
    const CONTRAST_FRAG = `#version 300 es
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
}
`;
    class ContrastEnhancerWebGL {
        blackPoint;
        whitePoint;
        constructor(blackPoint = 0.01, whitePoint = 0.99) {
            this.blackPoint = blackPoint;
            this.whitePoint = whitePoint;
        }
        process(input) {
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
            const program = createProgram(CONTRAST_FRAG, 'contrast');
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
        }
    }
    // ============================================================================
    // QUANTIZATION - WebGL Implementation
    // ============================================================================
    const QUANTIZE_FRAG = `#version 300 es
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
}
`;
    class QuantizerWebGL {
        levels;
        constructor(levels = 8) {
            this.levels = levels;
        }
        process(input) {
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
            const program = createProgram(QUANTIZE_FRAG, 'quantize');
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
    const DEFAULT_BILATERAL_CONFIG = {
        sigmaSpatial: 3,
        sigmaRange: 0.1,
        radiusMultiplier: 2,
    };
    const DEFAULT_MEDIAN_CONFIG = {
        radius: 2,
    };
    const DEFAULT_KUWAHARA_CONFIG = {
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
     */
    let BilateralFilter$1 = class BilateralFilter {
        config;
        constructor(config = {}) {
            this.config = { ...DEFAULT_BILATERAL_CONFIG, ...config };
        }
        process(input) {
            const cfg = this.config;
            const { width, height } = input;
            const output = createChannelImage(width, height);
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
    let MedianFilter$1 = class MedianFilter {
        config;
        constructor(config = {}) {
            this.config = { ...DEFAULT_MEDIAN_CONFIG, ...config };
        }
        process(input) {
            const { width, height } = input;
            const output = createChannelImage(width, height);
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
    let KuwaharaFilter$1 = class KuwaharaFilter {
        config;
        constructor(config = {}) {
            this.config = { ...DEFAULT_KUWAHARA_CONFIG, ...config };
        }
        process(input) {
            const { width, height } = input;
            const output = createChannelImage(width, height);
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
    let GaussianBlur$1 = class GaussianBlur {
        sigma;
        constructor(sigma = 1.0) {
            this.sigma = sigma;
        }
        process(input) {
            const { width, height } = input;
            const sigma = this.sigma;
            if (sigma < 0.1) {
                return { data: new Float32Array(input.data), width, height };
            }
            const radius = Math.ceil(sigma * 3);
            const kernelSize = radius * 2 + 1;
            const kernel = generateGaussianKernel$2(sigma, kernelSize);
            // Horizontal pass
            const temp = createChannelImage(width, height);
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
            const output = createChannelImage(width, height);
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
    let ContrastEnhancer$1 = class ContrastEnhancer {
        blackPoint;
        whitePoint;
        constructor(blackPoint = 0.01, whitePoint = 0.99) {
            this.blackPoint = blackPoint;
            this.whitePoint = whitePoint;
        }
        process(input) {
            const { width, height, data } = input;
            const output = createChannelImage(width, height);
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
    let Quantizer$1 = class Quantizer {
        levels;
        constructor(levels = 8) {
            this.levels = levels;
        }
        process(input) {
            const { width, height, data } = input;
            const output = createChannelImage(width, height);
            const size = width * height;
            const step = 1 / (this.levels - 1);
            for (let i = 0; i < size; i++) {
                output.data[i] = Math.round(data[i] / step) * step;
            }
            return output;
        }
    };

    /**
     * Composed Preprocessing Module for XDoG/FDoG
     *
     * This module is the single entry point the rest of the codebase should
     * import from. Each exported class picks its backend ONCE, at
     * construction time:
     *
     *   - WebGL 2.0 available  -> delegates to the GPU implementation (webgl.ts)
     *   - WebGL 2.0 unavailable -> delegates to the CPU implementation (cpu.ts)
     */
    function useWebGL(options) {
        if (options?.forceCPU)
            return false;
        return isWebGLAvailable();
    }
    // ============================================================================
    // Composed Filters
    // ============================================================================
    /**
     * Edge-preserving smoothing filter. Uses the GPU implementation when
     * available, otherwise falls back to the CPU implementation.
     */
    class BilateralFilter {
        instance;
        constructor(config = {}, options) {
            this.instance = useWebGL(options)
                ? new BilateralFilterWebGL(config)
                : new BilateralFilter$1(config);
        }
        process(input) {
            return this.instance.process(input);
        }
    }
    /**
     * Median filter for salt-and-pepper noise removal.
     */
    class MedianFilter {
        instance;
        constructor(config = {}, options) {
            this.instance = useWebGL(options)
                ? new MedianFilterWebGL(config)
                : new MedianFilter$1(config);
        }
        process(input) {
            return this.instance.process(input);
        }
    }
    /**
     * Kuwahara filter for a painterly, stylized effect.
     */
    class KuwaharaFilter {
        instance;
        constructor(config = {}, options) {
            this.instance = useWebGL(options)
                ? new KuwaharaFilterWebGL(config)
                : new KuwaharaFilter$1(config);
        }
        process(input) {
            return this.instance.process(input);
        }
    }
    /**
     * Separable Gaussian blur.
     */
    class GaussianBlur {
        instance;
        constructor(sigma = 1.0, options) {
            this.instance = useWebGL(options)
                ? new GaussianBlurWebGL(sigma)
                : new GaussianBlur$1(sigma);
        }
        process(input) {
            return this.instance.process(input);
        }
    }
    /**
     * Histogram-percentile contrast stretch.
     */
    class ContrastEnhancer {
        instance;
        constructor(blackPoint = 0.01, whitePoint = 0.99, options) {
            this.instance = useWebGL(options)
                ? new ContrastEnhancerWebGL(blackPoint, whitePoint)
                : new ContrastEnhancer$1(blackPoint, whitePoint);
        }
        process(input) {
            return this.instance.process(input);
        }
    }
    /**
     * Posterize/quantize intensity levels.
     */
    class Quantizer {
        instance;
        constructor(levels = 8, options) {
            this.instance = useWebGL(options)
                ? new QuantizerWebGL(levels)
                : new Quantizer$1(levels);
        }
        process(input) {
            return this.instance.process(input);
        }
    }
    // ============================================================================
    // Presets
    // ============================================================================
    // Built on top of the composed filters above, so each preset automatically
    // gets the GPU-when-available/CPU-otherwise behavior for free, with no
    // duplicated branching logic.
    const PreprocessingPresets = {
        /**
         * Light preprocessing - minimal smoothing
         * Good for: Clean studio photos, illustrations
         */
        light: (input) => {
            return new BilateralFilter({ sigmaSpatial: 2, sigmaRange: 0.08 }).process(input);
        },
        /**
         * Standard preprocessing - balanced smoothing
         * Good for: Most outdoor photos, portraits
         */
        standard: (input) => {
            return new BilateralFilter({ sigmaSpatial: 4, sigmaRange: 0.1 }).process(input);
        },
        /**
         * Heavy preprocessing - aggressive noise removal
         * Good for: Very textured images (grass, foliage, fabric)
         */
        heavy: (input) => {
            let result = new BilateralFilter({ sigmaSpatial: 5, sigmaRange: 0.12 }).process(input);
            result = new BilateralFilter({ sigmaSpatial: 3, sigmaRange: 0.1 }).process(result);
            return result;
        },
        /**
         * Artistic preprocessing - painterly smoothing
         * Good for: Stylized/artistic output
         */
        artistic: (input) => {
            let result = new KuwaharaFilter({ radius: 4 }).process(input);
            result = new BilateralFilter({ sigmaSpatial: 2, sigmaRange: 0.08 }).process(result);
            return result;
        },
        /**
         * Photo preprocessing - for photos with grass/nature
         * Good for: Landscape, outdoor scenes
         */
        nature: (input) => {
            let result = new BilateralFilter({ sigmaSpatial: 6, sigmaRange: 0.15 }).process(input);
            result = new BilateralFilter({ sigmaSpatial: 3, sigmaRange: 0.08 }).process(result);
            return result;
        },
    };
    // ============================================================================
    // Pipeline (Fluent API)
    // ============================================================================
    /**
     * Convenience class for chaining preprocessing operations. Each stage picks
     * its backend (GPU vs CPU) independently at the time it's added, using
     * whatever `isWebGLAvailable()` reports at that moment.
     */
    class PreprocessingPipeline {
        options;
        operations = [];
        constructor(options) {
            this.options = options;
        }
        bilateral(config) {
            this.operations.push(new BilateralFilter(config, this.options));
            return this;
        }
        median(config) {
            this.operations.push(new MedianFilter(config, this.options));
            return this;
        }
        kuwahara(config) {
            this.operations.push(new KuwaharaFilter(config, this.options));
            return this;
        }
        gaussian(sigma) {
            this.operations.push(new GaussianBlur(sigma, this.options));
            return this;
        }
        contrast(blackPoint, whitePoint) {
            this.operations.push(new ContrastEnhancer(blackPoint, whitePoint, this.options));
            return this;
        }
        quantize(levels) {
            this.operations.push(new Quantizer(levels, this.options));
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
        apply(input) {
            let result = input;
            for (const op of this.operations) {
                result = op.process(result);
            }
            return result;
        }
        clear() {
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
        LocalVariancePreprocessorOptimized: LocalVariancePreprocessorOptimized,
        MedianFilter: MedianFilter,
        PreprocessingPipeline: PreprocessingPipeline,
        PreprocessingPresets: PreprocessingPresets,
        Quantizer: Quantizer,
        disposeWebGL: disposeWebGL,
        isWebGLAvailable: isWebGLAvailable,
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
            const flowBlur = new FlowGuidedBlur(etf, { stepSize: cfg.stepSize });
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
                    const mask = createChannelImage(width, height);
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
                const baseMask = createChannelImage(width, height);
                for (let j = 0; j < width * height; j++) {
                    baseMask.data[j] = 0.0; // No hatching in lightest areas
                }
                masks.push(baseMask);
            }
            else {
                // Non-cumulative: independent bands (original behavior, but fixed)
                for (let i = 0; i <= levels.length; i++) {
                    const mask = createChannelImage(width, height);
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
            const output = createChannelImage(width, height);
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
            const data = createChannelImage(width, height);
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
            const data = createChannelImage(width, height);
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
            const output = createChannelImage(width, height);
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

    exports.DEFAULT_ETF_CONFIG = DEFAULT_ETF_CONFIG;
    exports.DoGProcessor = DoGProcessor;
    exports.EdgeTangentFlow = EdgeTangentFlow;
    exports.ThresholdModes = ThresholdModes;
    exports.applyCustomThreshold = applyCustomThreshold;
    exports.blur = index$2;
    exports.dog = index$3;
    exports.extensions = index;
    exports.preprocess = index$1;
    exports.threshold = threshold;
    exports.utilities = index$4;

}));
//# sourceMappingURL=index.umd.js.map
