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

import type { ChannelImage, FlowField, Vec2, ETFConfig, ETFComputer } from '../interfaces/base.js';
import { DEFAULT_ETF_CONFIG } from '../interfaces/base.js';
import { isWebGLComputeSupported, generateGaussianKernel } from '../utils/index.js';
import { TangentFlowField } from './flow-field.js';
import { BaseWebGLStrategy } from '../base.js';

/**
 * WebGL context and resources for ETF computation
 */
interface WebGLResources {
  gl: WebGL2RenderingContext;
  canvas: OffscreenCanvas | HTMLCanvasElement;
  // Shader programs
  gradientProgram: WebGLProgram;
  structureTensorProgram: WebGLProgram;
  gaussianBlurHProgram: WebGLProgram;
  gaussianBlurVProgram: WebGLProgram;
  tangentExtractProgram: WebGLProgram;
  tangentRefineProgram: WebGLProgram;
  // Geometry
  quadVAO: WebGLVertexArrayObject;
  quadVBO: WebGLBuffer;
}

/**
 * Shader source code
 */
const VERTEX_SHADER = `#version 300 es
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
  // Note: with additive blending enabled, writing this for each channel
  // in turn accumulates E, F, G, and magnitude across channels — this is
  // the GPU-side equivalent of Di Zenzo tensor summation.
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
 * WebGL-backed ETFComputer. Holds a lazily-initialized GPU context and
 * shader programs; call dispose() when done to release them.
 */
export class WebGLEdgeTangentFlowComputer extends BaseWebGLStrategy implements ETFComputer {
  private resources: WebGLResources | null = null;

  /**
   * Check if WebGL2 with the required float texture extensions is
   * supported in the current environment. Async to match the
   * `ETFComputerCtor` shape shared with the WebGPU backend, even though
   * this particular check is cheap and synchronous under the hood.
   */
  static async isSupported(): Promise<boolean> {
    return isWebGLComputeSupported();
  }

  static getUnsupportedReason(): string | undefined {
    if (isWebGLComputeSupported()) {
      return undefined;
    }
    return 'WebGL2 with float texture support (EXT_color_buffer_float) is not available in this environment';
  }

  async compute(
    input: ChannelImage,
    config: Partial<ETFConfig> = {},
    sigmaC?: number
  ): Promise<FlowField> {
    return this.computeMultiChannel([input], config, sigmaC);
  }

  async computeMultiChannel(
    inputs: ChannelImage[],
    config: Partial<ETFConfig> = {},
    sigmaC?: number
  ): Promise<FlowField> {
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
    const gradientFB = createFramebuffer(gl, width, height, gl.RGBA32F);
    const tensorAccumFB = createFramebuffer(gl, width, height, gl.RGBA32F);
    const blurTempFB = createFramebuffer(gl, width, height, gl.RGBA32F);
    const blurOutputFB = createFramebuffer(gl, width, height, gl.RGBA32F);
    const tangentFB1 = createFramebuffer(gl, width, height, gl.RGBA32F);
    const tangentFB2 = createFramebuffer(gl, width, height, gl.RGBA32F);

    const channelTextures: WebGLTexture[] = [];

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
    } finally {
      gl.disable(gl.BLEND);
      for (const tex of channelTextures) {
        gl.deleteTexture(tex);
      }
    }

    // Step 3: Gaussian blur the (possibly channel-summed) structure tensor
    const smoothSigma = sigmaC ?? (cfg.kernelSize / 2.45);
    const radius = Math.min(16, Math.ceil(smoothSigma * 2.45)); // Cap at 16 for shader array limit
    const kernelSize = radius * 2 + 1;
    const kernel = generateGaussianKernel(smoothSigma, kernelSize);

    // Horizontal blur
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurTempFB.fb);
    gl.useProgram(res.gaussianBlurHProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tensorAccumFB.tex);
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
    const tangents: Vec2[] = new Array(width * height);
    for (let i = 0; i < width * height; i++) {
      tangents[i] = {
        x: pixels[i * 4],
        y: pixels[i * 4 + 1],
      };
    }

    // Cleanup temporary resources (channel textures already freed above)
    deleteFramebuffer(gl, gradientFB);
    deleteFramebuffer(gl, tensorAccumFB);
    deleteFramebuffer(gl, blurTempFB);
    deleteFramebuffer(gl, blurOutputFB);
    deleteFramebuffer(gl, tangentFB1);
    deleteFramebuffer(gl, tangentFB2);

    return TangentFlowField.fromVec2Array(tangents, width, height);
    });
  }

  /**
   * Release WebGL resources held by this computer (programs, VAO/VBO,
   * and implicitly the canvas/context). Safe to call multiple times.
   */
  dispose(): void {
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
  private initResources(width: number, height: number): WebGLResources {
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
    }) as WebGL2RenderingContext;

    if (!gl) {
      throw new Error('WebGL2 not supported');
    }

    // Enable float textures
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');

    // Create shader programs
    const gradientProgram = createProgram(gl, VERTEX_SHADER, GRADIENT_SHADER);
    const structureTensorProgram = createProgram(gl, VERTEX_SHADER, STRUCTURE_TENSOR_SHADER);
    const gaussianBlurHProgram = createProgram(gl, VERTEX_SHADER, GAUSSIAN_BLUR_H_SHADER);
    const gaussianBlurVProgram = createProgram(gl, VERTEX_SHADER, GAUSSIAN_BLUR_V_SHADER);
    const tangentExtractProgram = createProgram(gl, VERTEX_SHADER, TANGENT_EXTRACT_SHADER);
    const tangentRefineProgram = createProgram(gl, VERTEX_SHADER, TANGENT_REFINE_SHADER);

    // Create fullscreen quad
    const quadVAO = gl.createVertexArray()!;
    const quadVBO = gl.createBuffer()!;

    gl.bindVertexArray(quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  -1, 1,
      -1,  1,  1, -1,   1, 1,
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
}

// ============== Helper Functions ==============

function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }

  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
  const vert = createShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = createShader(gl, gl.FRAGMENT_SHADER, fragSrc);

  const program = gl.createProgram()!;
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

function createTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internalFormat: number,
  format: number,
  data?: Float32Array | null
): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, gl.FLOAT, data ?? null);
  return tex;
}

interface Framebuffer {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
}

function createFramebuffer(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internalFormat: number
): Framebuffer {
  const tex = createTexture(gl, width, height, internalFormat, gl.RGBA, null);
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer incomplete: ${status}`);
  }

  return { fb, tex };
}

function deleteFramebuffer(gl: WebGL2RenderingContext, fb: Framebuffer): void {
  gl.deleteFramebuffer(fb.fb);
  gl.deleteTexture(fb.tex);
}

function drawQuad(gl: WebGL2RenderingContext, vao: WebGLVertexArrayObject): void {
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindVertexArray(null);
}