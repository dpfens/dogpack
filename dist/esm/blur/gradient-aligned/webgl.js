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
import { DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG } from '../../types.js';
import { generateGaussianKernel, createChannelImage } from '../../utils/index.js';
// Must match the unrolled loop bound in FRAGMENT_SRC below.
const MAX_SAMPLES = 256;
const VERTEX_SRC = `#version 300 es
layout(location = 0) in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;
const FRAGMENT_SRC = `#version 300 es
precision highp float;

#define MAX_SAMPLES ${MAX_SAMPLES}

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
export class WebGLGradientAlignedBlur {
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
        this.program = createProgram(gl, VERTEX_SRC, FRAGMENT_SRC);
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
        const halfSamples = Math.min(MAX_SAMPLES - 1, Math.ceil((sigma * 2) / this.config.stepSize));
        if (Math.ceil((sigma * 2) / this.config.stepSize) > MAX_SAMPLES - 1) {
            console.warn(`[GradientAlignedBlur/WebGL] halfSamples clamped to ${MAX_SAMPLES - 1} (sigma=${sigma} wanted more); kernel truncated. Raise MAX_SAMPLES if this matters.`);
        }
        const numSamples = halfSamples * 2 + 1;
        const weights = generateGaussianKernel(sigma, numSamples);
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
//# sourceMappingURL=webgl.js.map