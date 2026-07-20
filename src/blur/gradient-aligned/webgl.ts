/**
 * WebGL2-accelerated gradient-aligned blur for FDoG
 *
 * Runs the exact same perpendicular-to-flow sampling as
 * CPUGradientAlignedBlur, but as a single fullscreen-quad fragment shader
 * pass on the GPU instead of a per-pixel JS loop.
 *
 */
import {
  DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG,
  type BlurStrategy,
  type ChannelImage,
  type FlowField,
  type GradientAlignedBlurBackendConfig,
  type GradientAlignedBlurConfig,
} from '../../interfaces/base.js';
import { generateGaussianKernel, createChannelImage } from '../../utils/index.js';
import FRAGMENT_SOURCE from '../shaders/gradient-aligned/webgl2-fragment.glsl.js';
import VERTEX_SOURCE from '../shaders//gradient-aligned/vertex.glsl.js'

// Must match the unrolled loop bound in FRAGMENT_SOURCE.
const MAX_SAMPLES = 256;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`[GradientAlignedBlur/WebGL] Shader compile error: ${info}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const program = gl.createProgram()!;
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
 * `getUnsupportedReason()` — cheap enough (one canvas + one context) that
 * we don't bother caching the result across calls.
 */
function probeWebGL2Support(): string | undefined {
  try {
    const canvas: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { antialias: false }) as WebGL2RenderingContext | null;
    if (!gl) {
      return '[GradientAlignedBlur/WebGL] WebGL2 not available';
    }
    if (!gl.getExtension('EXT_color_buffer_float')) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return '[GradientAlignedBlur/WebGL] EXT_color_buffer_float not supported (required for R32F render targets)';
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return undefined;
  } catch (err) {
    return `[GradientAlignedBlur/WebGL] probe threw: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export class WebGLGradientAlignedBlur implements BlurStrategy {
  readonly backend = 'webgl' as const;
  private config: GradientAlignedBlurConfig;
  private gl: WebGL2RenderingContext;
  private canvas: OffscreenCanvas | HTMLCanvasElement;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;

  private inputTexture: WebGLTexture;
  private flowTexture: WebGLTexture | null = null;
  private flowFieldWidth = 0;
  private flowFieldHeight = 0;
  private flowDirty = true;

  private fbo: WebGLFramebuffer;
  private outputTexture: WebGLTexture;
  private fboWidth = 0;
  private fboHeight = 0;

  private uniforms: Record<string, WebGLUniformLocation | null> = {};

  // Set by the 'webglcontextlost' listener below. Checked at the top of
  // blur() so a lost context surfaces as an immediate, clear error on the
  // very next call instead of failing deep inside a GL call (or worse,
  // silently no-opping, since a lost context makes most GL calls into
  // silent no-ops rather than throws).
  private contextLost = false;

  private flowField: FlowField;

  // Single-arg constructor (flowField bundled into config) so this class
  // satisfies `BlurStrategyCtor`'s `new (config: any)` shape.
  constructor(config: GradientAlignedBlurBackendConfig) {
    this.flowField = config.flowField;
    this.config = { ...DEFAULT_GRADIENT_ALIGNED_BLUR_CONFIG, ...config };

    const canvas: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false }) as
      | WebGL2RenderingContext
      | null;
    if (!gl) {
      throw new Error('[GradientAlignedBlur/WebGL] WebGL2 not available');
    }
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('[GradientAlignedBlur/WebGL] EXT_color_buffer_float not supported (required for R32F render targets)');
    }

    // Proactively catch context loss (driver crash, GPU reset, tab backgrounded
    // and reclaimed, etc.) rather than waiting for the next blur() call to
    // fail deep inside a GL call. preventDefault() signals we'd support
    // restoration if it happens, but we don't currently rebuild GL state on
    // 'webglcontextrestored' — a lost context is treated as a terminal
    // failure for this instance, and the wrapper demotes to the next backend.
    canvas.addEventListener('webglcontextlost', (event: Event) => {
      event.preventDefault();
      this.contextLost = true;
      console.warn('[GradientAlignedBlur/WebGL] context lost');
    });

    this.canvas = canvas;
    this.gl = gl;
    this.program = createProgram(gl, VERTEX_SOURCE, FRAGMENT_SOURCE);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    // Two triangles covering clip space [-1, 1]
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.inputTexture = gl.createTexture()!;
    this.setupTextureParams(this.inputTexture);

    this.outputTexture = gl.createTexture()!;
    this.fbo = gl.createFramebuffer()!;

    gl.useProgram(this.program);
    ['u_input', 'u_flowDir', 'u_resolution', 'u_halfSamples', 'u_stepSize', 'u_weights'].forEach((name) => {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    });
    gl.uniform1i(this.uniforms['u_input'], 0);
    gl.uniform1i(this.uniforms['u_flowDir'], 1);
  }

  /**
   * Cheap synchronous-capability probe wrapped in an async signature to
   * match `BlurStrategyCtor`. Doesn't touch the instance — creates its own
   * throwaway canvas/context, same as the constructor does for real, so a
   * `true` here means "constructing an instance should work", not a
   * guarantee (construction can still fail — see key decisions in the
   * design doc on why we still try/catch `new Ctor(...)`).
   */
  static async isSupported(): Promise<boolean> {
    return probeWebGL2Support() === undefined;
  }

  static async getUnsupportedReason(): Promise<string | undefined> {
    return probeWebGL2Support();
  }

  private setupTextureParams(tex: WebGLTexture): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // NEAREST everywhere — we do bilinear manually in-shader via texelFetch,
    // so hardware filtering support for float textures is irrelevant here.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  setFlowField(flowField: FlowField): void {
    this.flowField = flowField;
    this.flowDirty = true;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.inputTexture);
    gl.deleteTexture(this.outputTexture);
    if (this.flowTexture) gl.deleteTexture(this.flowTexture);
    gl.deleteFramebuffer(this.fbo);
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private ensureFbo(width: number, height: number): void {
    if (this.fboWidth === width && this.fboHeight === height) return;
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

  private bakeFlowTexture(width: number, height: number): void {
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
    if (!this.flowTexture) this.flowTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.flowTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, width, height, 0, gl.RG, gl.FLOAT, data);
    this.setupTextureParams(this.flowTexture);
    this.flowFieldWidth = width;
    this.flowFieldHeight = height;
    this.flowDirty = false;
    console.log(
      `[GradientAlignedBlur/WebGL] Baked flow field texture (${width}x${height}): ${(performance.now() - t0).toFixed(2)}ms`,
    );
  }

  async blur(input: ChannelImage, sigma: number): Promise<ChannelImage> {
    if (this.contextLost || this.gl.isContextLost()) {
      throw new Error('[GradientAlignedBlur/WebGL] context lost');
    }

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
      console.warn(
        `[GradientAlignedBlur/WebGL] halfSamples clamped to ${MAX_SAMPLES - 1} (sigma=${sigma} wanted more); kernel truncated. Raise MAX_SAMPLES if this matters.`,
      );
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
    console.log(
      `[GradientAlignedBlur/WebGL] Draw call submit (JS-side only, GPU work is async — see note at top of file): ${(performance.now() - tDraw).toFixed(2)}ms`,
    );

    const tReadback = performance.now();
    const output = createChannelImage(width, height);
    gl.readPixels(0, 0, width, height, gl.RED, gl.FLOAT, output.data);
    console.log(
      `[GradientAlignedBlur/WebGL] Readback (this is where the GPU wait actually happens): ${(performance.now() - tReadback).toFixed(2)}ms`,
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    console.log(
      `[GradientAlignedBlur/WebGL] blur() total (sigma=${sigma.toFixed(2)}, halfSamples=${halfSamples}): ${(performance.now() - tTotal).toFixed(2)}ms`,
    );

    return output;
  }
}