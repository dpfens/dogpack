"use strict";
/**
 * WebGL-accelerated Edge Tangent Flow computation
 *
 * Provides significant speedup over the CPU implementation by running
 * gradient computation, structure tensor building/smoothing, and
 * tangent extraction on the GPU.
 *
 * Multi-channel support follows the same Di Zenzo multichannel structure
 * tensor approach as the CPU backend (per-channel tensors summed, then a
 * single eigendecomposition on the combined tensor) — but the summation
 * itself is done on the GPU via additive blending straight into an
 * accumulator framebuffer, rather than reading tensors back to JS and
 * summing them there. Everything from the Gaussian blur pass onward is
 * identical whether the accumulated tensor came from one channel or many.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebGLEdgeTangentFlowComputer = void 0;
const base_js_1 = require("../interfaces/base.js");
const index_js_1 = require("../utils/index.js");
const flow_field_js_1 = require("./flow-field.js");
const base_js_2 = require("../base.js");
const vertex_glsl_js_1 = require("./shaders/webgl/vertex.glsl.js");
const gradient_glsl_js_1 = require("./shaders/webgl/gradient.glsl.js");
const structural_tensor_glsl_js_1 = require("./shaders/webgl/structural_tensor.glsl.js");
const gaussian_blur_h_glsl_js_1 = require("./shaders/webgl/gaussian_blur_h.glsl.js");
const gaussian_blur_v_glsl_js_1 = require("./shaders/webgl/gaussian_blur_v.glsl.js");
const tangent_extract_glsl_js_1 = require("./shaders/webgl/tangent_extract.glsl.js");
const tangent_refine_glsl_js_1 = require("./shaders/webgl/tangent_refine.glsl.js");
const finalize_magnitude_glsl_js_1 = require("./shaders/webgl/finalize_magnitude.glsl.js");
/**
 * WebGL-backed ETFComputer. Holds a lazily-initialized GPU context and
 * shader programs; call dispose() when done to release them.
 */
class WebGLEdgeTangentFlowComputer extends base_js_2.BaseWebGLStrategy {
    resources = null;
    /**
     * Check if WebGL2 with the required float texture extensions is
     * supported in the current environment. Async to match the
     * `ETFComputerCtor` shape shared with the WebGPU backend, even though
     * this particular check is cheap and synchronous under the hood.
     */
    static async isSupported() {
        return (0, index_js_1.isWebGLComputeSupported)();
    }
    static getUnsupportedReason() {
        if ((0, index_js_1.isWebGLComputeSupported)()) {
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
        const cfg = { ...base_js_1.DEFAULT_ETF_CONFIG, ...config };
        const res = this.initResources(width, height);
        const { gl } = res;
        return this.runGuarded(gl, () => {
            gl.viewport(0, 0, width, height);
            // Per-channel scratch (overwritten each iteration) and the tensor
            // accumulator that channels are additively blended into.
            const gradientFB = createFramebuffer(gl, width, height, gl.RGBA32F);
            const tensorAccumFB = createFramebuffer(gl, width, height, gl.RGBA32F);
            const blurTempFB = createFramebuffer(gl, width, height, gl.RGBA32F);
            const blurOutputFB = createFramebuffer(gl, width, height, gl.RGBA32F);
            const tangentFB1 = createFramebuffer(gl, width, height, gl.RGBA32F);
            const tangentFB2 = createFramebuffer(gl, width, height, gl.RGBA32F);
            const tensorFinalizedFB = createFramebuffer(gl, width, height, gl.RGBA32F);
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
            // Step 4: Gaussian blur the finalized (E, F, G, mag) tensor —
            // blurring all four components together keeps magnitude aligned
            // with the smoothed tensor that tangent_extract will read.
            const smoothSigma = sigmaC ?? (cfg.kernelSize / 2.45);
            const radius = Math.min(16, Math.ceil(smoothSigma * 2.45));
            const kernelSize = radius * 2 + 1;
            const kernel = (0, index_js_1.generateGaussianKernel)(smoothSigma, kernelSize);
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
            return flow_field_js_1.TangentFlowField.fromVec2Array(tangents, width, height, magnitude, anisotropy);
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
        const gradientProgram = createProgram(gl, vertex_glsl_js_1.default, gradient_glsl_js_1.default);
        const structureTensorProgram = createProgram(gl, vertex_glsl_js_1.default, structural_tensor_glsl_js_1.default);
        const gaussianBlurHProgram = createProgram(gl, vertex_glsl_js_1.default, gaussian_blur_h_glsl_js_1.default);
        const gaussianBlurVProgram = createProgram(gl, vertex_glsl_js_1.default, gaussian_blur_v_glsl_js_1.default);
        const tangentExtractProgram = createProgram(gl, vertex_glsl_js_1.default, tangent_extract_glsl_js_1.default);
        const tangentRefineProgram = createProgram(gl, vertex_glsl_js_1.default, tangent_refine_glsl_js_1.default);
        const finalizeMagnitudeProgram = createProgram(gl, vertex_glsl_js_1.default, finalize_magnitude_glsl_js_1.default);
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
exports.WebGLEdgeTangentFlowComputer = WebGLEdgeTangentFlowComputer;
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
function createProgram(gl, vertSrc, fragSrc) {
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
function createFramebuffer(gl, width, height, internalFormat) {
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
//# sourceMappingURL=webgl.js.map