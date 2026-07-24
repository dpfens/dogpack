"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Quantizer = exports.ContrastEnhancer = exports.GaussianBlur = exports.KuwaharaFilter = exports.MedianFilter = exports.BilateralFilter = exports.QuantizerWebGL = exports.ContrastEnhancerWebGL = exports.KuwaharaFilterWebGL = exports.MedianFilterWebGL = exports.GaussianBlurWebGL = exports.BilateralFilterWebGL = void 0;
exports.isWebGLAvailable = isWebGLAvailable;
exports.disposeWebGL = disposeWebGL;
const base_js_1 = require("../../base.js");
const bilateral_glsl_js_1 = require("./shaders/webgl/bilateral.glsl.js");
const contrast_glsl_js_1 = require("./shaders/webgl/contrast.glsl.js");
const guassian_horizontal_glsl_js_1 = require("./shaders/webgl/guassian-horizontal.glsl.js");
const guassian_vertical_glsl_js_1 = require("./shaders/webgl/guassian-vertical.glsl.js");
const kuwahara_glsl_js_1 = require("./shaders/webgl/kuwahara.glsl.js");
const median_small_glsl_js_1 = require("./shaders/webgl/median-small.glsl.js");
const median_glsl_js_1 = require("./shaders/webgl/median.glsl.js");
const quantize_glsl_js_1 = require("./shaders/webgl/quantize.glsl.js");
// Default config values (mirrors the CPU implementation in cpu.ts)
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
class BilateralFilterWebGL extends base_js_1.BaseWebGLStrategy {
    config;
    static async isSupported() {
        return isWebGLAvailable();
    }
    static async getUnsupportedReason() {
        return isWebGLAvailable() ? undefined : 'WebGL 2.0 is not available in this environment';
    }
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_BILATERAL_CONFIG, ...config };
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
            const program = createProgram(bilateral_glsl_js_1.default, 'bilateral');
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
exports.BilateralFilterWebGL = BilateralFilterWebGL;
exports.BilateralFilter = BilateralFilterWebGL;
// ============================================================================
// GAUSSIAN BLUR - Separable WebGL Implementation (Very Fast)
// ============================================================================
class GaussianBlurWebGL extends base_js_1.BaseWebGLStrategy {
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
            const hProgram = createProgram(guassian_horizontal_glsl_js_1.default, 'gaussianH');
            const vProgram = createProgram(guassian_vertical_glsl_js_1.default, 'gaussianV');
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
exports.GaussianBlurWebGL = GaussianBlurWebGL;
exports.GaussianBlur = GaussianBlurWebGL;
// ============================================================================
// MEDIAN FILTER - WebGL Approximation using Weighted Histogram
// ============================================================================
class MedianFilterWebGL extends base_js_1.BaseWebGLStrategy {
    config;
    static async isSupported() {
        return isWebGLAvailable();
    }
    static async getUnsupportedReason() {
        return isWebGLAvailable() ? undefined : 'WebGL 2.0 is not available in this environment';
    }
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_MEDIAN_CONFIG, ...config };
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
            const shaderSource = radius <= 2 ? median_small_glsl_js_1.default : median_glsl_js_1.default;
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
exports.MedianFilterWebGL = MedianFilterWebGL;
exports.MedianFilter = MedianFilterWebGL;
// ============================================================================
// KUWAHARA FILTER - WebGL Implementation
// ============================================================================
class KuwaharaFilterWebGL extends base_js_1.BaseWebGLStrategy {
    config;
    static async isSupported() {
        return isWebGLAvailable();
    }
    static async getUnsupportedReason() {
        return isWebGLAvailable() ? undefined : 'WebGL 2.0 is not available in this environment';
    }
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_KUWAHARA_CONFIG, ...config };
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
            const program = createProgram(kuwahara_glsl_js_1.default, 'kuwahara');
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
exports.KuwaharaFilterWebGL = KuwaharaFilterWebGL;
exports.KuwaharaFilter = KuwaharaFilterWebGL;
// ============================================================================
// CONTRAST ENHANCEMENT - WebGL Implementation
// ============================================================================
class ContrastEnhancerWebGL extends base_js_1.BaseWebGLStrategy {
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
            const program = createProgram(contrast_glsl_js_1.default, 'contrast');
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
exports.ContrastEnhancerWebGL = ContrastEnhancerWebGL;
exports.ContrastEnhancer = ContrastEnhancerWebGL;
// ============================================================================
// QUANTIZATION - WebGL Implementation
// ============================================================================
class QuantizerWebGL extends base_js_1.BaseWebGLStrategy {
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
            const program = createProgram(quantize_glsl_js_1.default, 'quantize');
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
exports.QuantizerWebGL = QuantizerWebGL;
exports.Quantizer = QuantizerWebGL;
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
//# sourceMappingURL=webgl.js.map