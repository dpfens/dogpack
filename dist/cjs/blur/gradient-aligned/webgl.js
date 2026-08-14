"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebGLGradientAlignedBlur = void 0;
/**
 * WebGL2-accelerated gradient-aligned blur for FDoG
 *
 * Runs the exact same perpendicular-to-flow sampling as
 * CPUGradientAlignedBlur, but as a single fullscreen-quad fragment shader
 * pass on the GPU instead of a per-pixel JS loop.
 *
 */
const base_js_1 = require("../../interfaces/base.js");
const webgl2_fragment_glsl_js_1 = require("../shaders/gradient-aligned/webgl2-fragment.glsl.js");
const vertex_glsl_js_1 = require("../shaders/gradient-aligned/vertex.glsl.js");
const math_js_1 = require("../../utils/math.js");
const image_js_1 = require("../../utils/image.js");
// Must match the unrolled loop bound in FRAGMENT_SOURCE.
const MAX_SAMPLES = 256;
function compileShader(gl, type, source) {
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
function createProgram(gl, vsSrc, fsSrc) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
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
        this.config = { ...base_js_1.DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG, ...config };
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
        this.program = createProgram(gl, vertex_glsl_js_1.default, webgl2_fragment_glsl_js_1.default);
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
        const halfSamples = Math.min(MAX_SAMPLES - 1, Math.ceil((sigma * 2) / this.config.stepSize));
        const numSamples = halfSamples * 2 + 1;
        const weights = (0, math_js_1.generateGaussianKernel)(sigma, numSamples);
        const paddedWeights = new Float32Array(MAX_SAMPLES);
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
        const output = (0, image_js_1.createChannelImage)(width, height);
        gl.readPixels(0, 0, width, height, gl.RED, gl.FLOAT, output.data);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return output;
    }
}
exports.WebGLGradientAlignedBlur = WebGLGradientAlignedBlur;
//# sourceMappingURL=webgl.js.map