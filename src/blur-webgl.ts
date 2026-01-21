/**
 * WebGL-accelerated blur strategies
 */

import { GrayscaleImage, FlowField } from './types.js';
import { BlurStrategy } from './blur.js';
import { createGrayscaleImage } from './utils.js';

/**
 * WebGL context and resource management
 */
interface WebGLResources {
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  canvas: OffscreenCanvas | HTMLCanvasElement;
  horizontalBlurProgram: WebGLProgram;
  verticalBlurProgram: WebGLProgram;
  quadBuffer: WebGLBuffer;
  texCoordBuffer: WebGLBuffer;
}

/**
 * Vertex shader - simple fullscreen quad
 */
const VERTEX_SHADER = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

/**
 * Fragment shader for horizontal Gaussian blur pass
 */
const HORIZONTAL_BLUR_SHADER = `
  precision highp float;
  
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform float u_kernel[64];
  uniform int u_kernelSize;
  
  varying vec2 v_texCoord;
  
  void main() {
    vec2 texelSize = 1.0 / u_resolution;
    float result = 0.0;
    int halfSize = u_kernelSize / 2;
    
    for (int i = 0; i < 64; i++) {
      if (i >= u_kernelSize) break;
      int offset = i - halfSize;
      vec2 samplePos = v_texCoord + vec2(float(offset) * texelSize.x, 0.0);
      result += texture2D(u_image, samplePos).r * u_kernel[i];
    }
    
    gl_FragColor = vec4(result, result, result, 1.0);
  }
`;

/**
 * Fragment shader for vertical Gaussian blur pass
 */
const VERTICAL_BLUR_SHADER = `
  precision highp float;
  
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform float u_kernel[64];
  uniform int u_kernelSize;
  
  varying vec2 v_texCoord;
  
  void main() {
    vec2 texelSize = 1.0 / u_resolution;
    float result = 0.0;
    int halfSize = u_kernelSize / 2;
    
    for (int i = 0; i < 64; i++) {
      if (i >= u_kernelSize) break;
      int offset = i - halfSize;
      vec2 samplePos = v_texCoord + vec2(0.0, float(offset) * texelSize.y);
      result += texture2D(u_image, samplePos).r * u_kernel[i];
    }
    
    gl_FragColor = vec4(result, result, result, 1.0);
  }
`;

/**
 * Compile a WebGL shader
 */
function compileShader(
  gl: WebGLRenderingContext,
  source: string,
  type: number
): WebGLShader {
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
 * Create a WebGL program from vertex and fragment shaders
 */
function createProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string
): WebGLProgram {
  const vertexShader = compileShader(gl, vertexSource, gl.VERTEX_SHADER);
  const fragmentShader = compileShader(gl, fragmentSource, gl.FRAGMENT_SHADER);
  
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
 * Generate 1D Gaussian kernel
 */
function generateGaussianKernel(sigma: number, size: number): Float32Array {
  const kernel = new Float32Array(size);
  const center = Math.floor(size / 2);
  const sigma2 = 2 * sigma * sigma;
  
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - center;
    kernel[i] = Math.exp(-(x * x) / sigma2);
    sum += kernel[i];
  }
  
  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }
  
  return kernel;
}

/**
 * Configuration for WebGL blur
 */
export interface WebGLBlurConfig {
  /** Kernel size multiplier relative to sigma (default: 6) */
  kernelSizeMultiplier: number;
  /** Maximum kernel size (default: 63, limited by shader uniform array) */
  maxKernelSize: number;
}

const DEFAULT_WEBGL_CONFIG: WebGLBlurConfig = {
  kernelSizeMultiplier: 6,
  maxKernelSize: 63,
};

/**
 * WebGL-accelerated isotropic Gaussian blur
 * Uses separable convolution with two passes (horizontal + vertical)
 */
export class WebGLIsotropicBlur implements BlurStrategy {
  private config: WebGLBlurConfig;
  private resources: WebGLResources | null = null;
  private currentWidth = 0;
  private currentHeight = 0;
  private framebuffer: WebGLFramebuffer | null = null;
  private textures: WebGLTexture[] = [];
  
  /**
   * Check if WebGL is supported in the current environment
   */
  static isSupported(): boolean {
    try {
      // Check for OffscreenCanvas (preferred) or regular canvas
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(1, 1);
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        return gl !== null;
      } else if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        return gl !== null;
      }
      return false;
    } catch {
      return false;
    }
  }
  
  /**
   * Get reason if WebGL is not supported
   */
  static getUnsupportedReason(): string | undefined {
    if (typeof OffscreenCanvas === 'undefined' && typeof document === 'undefined') {
      return 'Neither OffscreenCanvas nor document is available';
    }
    
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(1, 1);
        if (!canvas.getContext('webgl2') && !canvas.getContext('webgl')) {
          return 'WebGL context creation failed on OffscreenCanvas';
        }
      } else {
        const canvas = document.createElement('canvas');
        if (!canvas.getContext('webgl2') && !canvas.getContext('webgl')) {
          return 'WebGL context creation failed';
        }
      }
    } catch (e) {
      return `WebGL initialization error: ${e}`;
    }
    
    return undefined;
  }
  
  constructor(config: Partial<WebGLBlurConfig> = {}) {
    this.config = { ...DEFAULT_WEBGL_CONFIG, ...config };
  }
  
  /**
   * Initialize WebGL resources lazily
   */
  private initResources(): WebGLResources {
    if (this.resources) {
      return this.resources;
    }
    
    // Create canvas
    let canvas: OffscreenCanvas | HTMLCanvasElement;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(1, 1);
    } else {
      canvas = document.createElement('canvas');
    }
    
    // Get WebGL context
    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext;
    if (!gl) {
      throw new Error('Failed to get WebGL context');
    }
    
    // Create shader programs
    const horizontalBlurProgram = createProgram(gl, VERTEX_SHADER, HORIZONTAL_BLUR_SHADER);
    const verticalBlurProgram = createProgram(gl, VERTEX_SHADER, VERTICAL_BLUR_SHADER);
    
    // Create fullscreen quad
    const quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ]), gl.STATIC_DRAW);
    
    // Create texture coordinate buffer
    const texCoordBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0, 0,
      1, 0,
      0, 1,
      1, 1,
    ]), gl.STATIC_DRAW);
    
    this.resources = {
      gl,
      canvas,
      horizontalBlurProgram,
      verticalBlurProgram,
      quadBuffer,
      texCoordBuffer,
    };
    
    return this.resources;
  }
  
  /**
   * Ensure textures and framebuffer are sized correctly
   */
  private ensureTextureSize(gl: WebGLRenderingContext, width: number, height: number): void {
    if (this.currentWidth === width && this.currentHeight === height) {
      return;
    }
    
    // Clean up old textures
    for (const tex of this.textures) {
      gl.deleteTexture(tex);
    }
    if (this.framebuffer) {
      gl.deleteFramebuffer(this.framebuffer);
    }
    
    // Create new textures (input, intermediate, output)
    this.textures = [];
    for (let i = 0; i < 3; i++) {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.textures.push(texture);
    }
    
    // Create framebuffer
    this.framebuffer = gl.createFramebuffer();
    
    this.currentWidth = width;
    this.currentHeight = height;
    
    // Resize canvas
    const { canvas } = this.resources!;
    canvas.width = width;
    canvas.height = height;
  }
  
  /**
   * Run a blur pass with the given program
   */
  private runBlurPass(
    gl: WebGLRenderingContext,
    program: WebGLProgram,
    inputTexture: WebGLTexture,
    outputTexture: WebGLTexture | null,
    kernel: Float32Array,
    width: number,
    height: number
  ): void {
    // Set up framebuffer for output (null = render to canvas)
    if (outputTexture) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outputTexture, 0);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    
    // Set up attributes
    const positionLoc = gl.getAttribLocation(program, 'a_position');
    const texCoordLoc = gl.getAttribLocation(program, 'a_texCoord');
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.resources!.quadBuffer);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.resources!.texCoordBuffer);
    gl.enableVertexAttribArray(texCoordLoc);
    gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0);
    
    // Set uniforms
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
    gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), width, height);
    gl.uniform1fv(gl.getUniformLocation(program, 'u_kernel'), kernel);
    gl.uniform1i(gl.getUniformLocation(program, 'u_kernelSize'), kernel.length);
    
    // Draw
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  
  async blur(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage> {
    if (sigma < 0.1) {
      return {
        data: new Float32Array(input.data),
        width: input.width,
        height: input.height,
      };
    }
    
    const { gl } = this.initResources();
    const { width, height } = input;
    
    this.ensureTextureSize(gl, width, height);
    
    // Compute kernel
    const kernelSize = Math.min(
      this.config.maxKernelSize,
      Math.max(3, Math.floor(sigma * this.config.kernelSizeMultiplier) | 1)
    );
    const kernel = generateGaussianKernel(sigma, kernelSize);
    
    // Pad kernel to 64 elements (shader expects fixed array)
    const paddedKernel = new Float32Array(64);
    paddedKernel.set(kernel);
    
    // Upload input to texture (convert grayscale to RGBA)
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
    
    // Horizontal blur pass: texture[0] -> texture[1]
    this.runBlurPass(
      gl,
      this.resources!.horizontalBlurProgram,
      this.textures[0],
      this.textures[1],
      paddedKernel,
      width,
      height
    );
    
    // Vertical blur pass: texture[1] -> texture[2]
    this.runBlurPass(
      gl,
      this.resources!.verticalBlurProgram,
      this.textures[1],
      this.textures[2],
      paddedKernel,
      width,
      height
    );
    
    // Read back result
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[2], 0);
    
    const outputRGBA = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, outputRGBA);
    
    // Convert back to grayscale
    const output = createGrayscaleImage(width, height);
    for (let i = 0; i < output.data.length; i++) {
      output.data[i] = outputRGBA[i * 4] / 255;
    }
    
    return output;
  }
  
  async blurAsync(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage> {
    return this.blur(input, sigma);
  }
  
  /**
   * Clean up WebGL resources
   */
  dispose(): void {
    if (!this.resources) return;
    
    const { gl } = this.resources;
    
    gl.deleteProgram(this.resources.horizontalBlurProgram);
    gl.deleteProgram(this.resources.verticalBlurProgram);
    gl.deleteBuffer(this.resources.quadBuffer);
    gl.deleteBuffer(this.resources.texCoordBuffer);
    
    for (const tex of this.textures) {
      gl.deleteTexture(tex);
    }
    
    if (this.framebuffer) {
      gl.deleteFramebuffer(this.framebuffer);
    }
    
    this.resources = null;
    this.textures = [];
    this.framebuffer = null;
  }
}

/**
 * Fragment shader for flow-guided blur
 * 
 * Note: WebGL 1.0 (GLSL ES 1.00) requires array indices to be constant expressions
 * or loop indices. We use a helper function with unrolled comparisons to work around
 * this limitation.
 */
const FLOW_BLUR_SHADER = `
  precision highp float;
  
  uniform sampler2D u_image;
  uniform sampler2D u_flowField;
  uniform vec2 u_resolution;
  uniform float u_kernel[64];
  uniform int u_kernelSize;
  
  varying vec2 v_texCoord;
  
  // Helper function to access kernel array with dynamic index
  // WebGL 1.0 requires constant or loop index for array access,
  // so we unroll the comparisons
  float getKernelValue(int index) {
    for (int i = 0; i < 64; i++) {
      if (i == index) return u_kernel[i];
    }
    return 0.0;
  }
  
  void main() {
    vec2 texelSize = 1.0 / u_resolution;
    int halfSize = u_kernelSize / 2;
    
    // Get flow direction at this pixel (stored as RG, normalized to 0-1)
    vec2 flow = texture2D(u_flowField, v_texCoord).rg * 2.0 - 1.0;
    
    float result = 0.0;
    float weightSum = 0.0;
    
    // Sample along positive flow direction
    vec2 pos = v_texCoord;
    for (int i = 0; i < 32; i++) {
      if (i > halfSize) break;
      int idx = halfSize + i;
      if (idx >= u_kernelSize) break;
      
      float w = getKernelValue(idx);
      result += texture2D(u_image, pos).r * w;
      weightSum += w;
      
      // Step along flow
      vec2 localFlow = texture2D(u_flowField, pos).rg * 2.0 - 1.0;
      pos += localFlow * texelSize;
    }
    
    // Sample along negative flow direction
    pos = v_texCoord;
    for (int i = 1; i < 32; i++) {
      if (i > halfSize) break;
      int idx = halfSize - i;
      if (idx < 0) break;
      
      // Step against flow first
      vec2 localFlow = texture2D(u_flowField, pos).rg * 2.0 - 1.0;
      pos -= localFlow * texelSize;
      
      float w = getKernelValue(idx);
      result += texture2D(u_image, pos).r * w;
      weightSum += w;
    }
    
    result = weightSum > 0.0 ? result / weightSum : 0.0;
    gl_FragColor = vec4(result, result, result, 1.0);
  }
`;

/**
 * WebGL-accelerated flow-guided blur
 * Uses line integral convolution along edge tangent directions
 */
export class WebGLFlowGuidedBlur implements BlurStrategy {
  private config: WebGLBlurConfig;
  private flowField: FlowField;
  private resources: {
    gl: WebGLRenderingContext;
    canvas: OffscreenCanvas | HTMLCanvasElement;
    program: WebGLProgram;
    quadBuffer: WebGLBuffer;
    texCoordBuffer: WebGLBuffer;
  } | null = null;
  private currentWidth = 0;
  private currentHeight = 0;
  private framebuffer: WebGLFramebuffer | null = null;
  private textures: WebGLTexture[] = [];
  private flowTexture: WebGLTexture | null = null;
  
  static isSupported(): boolean {
    return WebGLIsotropicBlur.isSupported();
  }
  
  static getUnsupportedReason(): string | undefined {
    return WebGLIsotropicBlur.getUnsupportedReason();
  }
  
  constructor(flowField: FlowField, config: Partial<WebGLBlurConfig> = {}) {
    this.flowField = flowField;
    this.config = { ...DEFAULT_WEBGL_CONFIG, ...config };
  }
  
  private initResources() {
    if (this.resources) return this.resources;
    
    let canvas: OffscreenCanvas | HTMLCanvasElement;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(1, 1);
    } else {
      canvas = document.createElement('canvas');
    }
    
    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext;
    if (!gl) throw new Error('Failed to get WebGL context');
    
    const program = createProgram(gl, VERTEX_SHADER, FLOW_BLUR_SHADER);
    
    const quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1, 1, 1,
    ]), gl.STATIC_DRAW);
    
    const texCoordBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0, 0, 1, 0, 0, 1, 1, 1,
    ]), gl.STATIC_DRAW);
    
    this.resources = { gl, canvas, program, quadBuffer, texCoordBuffer };
    return this.resources;
  }
  
  private ensureTextureSize(gl: WebGLRenderingContext, width: number, height: number): void {
    if (this.currentWidth === width && this.currentHeight === height) {
      return;
    }
    
    // Clean up old textures
    for (const tex of this.textures) {
      gl.deleteTexture(tex);
    }
    if (this.flowTexture) {
      gl.deleteTexture(this.flowTexture);
    }
    if (this.framebuffer) {
      gl.deleteFramebuffer(this.framebuffer);
    }
    
    // Create textures
    this.textures = [];
    for (let i = 0; i < 2; i++) {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.textures.push(texture);
    }
    
    // Create flow field texture
    this.flowTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.flowTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    
    // Upload flow field data
    const flowData = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const tangent = this.flowField.getTangent(x, y);
        // Encode tangent as 0-255 (mapping -1..1 to 0..255)
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
    
    const { canvas } = this.resources!;
    canvas.width = width;
    canvas.height = height;
  }
  
  async blur(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage> {
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
    
    // Compute kernel
    const kernelSize = Math.min(
      this.config.maxKernelSize,
      Math.max(3, Math.floor(sigma * this.config.kernelSizeMultiplier) | 1)
    );
    const kernel = generateGaussianKernel(sigma, kernelSize);
    const paddedKernel = new Float32Array(64);
    paddedKernel.set(kernel);
    
    // Upload input
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
    
    // Run blur
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
    
    // Read back
    const outputRGBA = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, outputRGBA);
    
    const output = createGrayscaleImage(width, height);
    for (let i = 0; i < output.data.length; i++) {
      output.data[i] = outputRGBA[i * 4] / 255;
    }
    
    return output;
  }
  
  async blurAsync(input: GrayscaleImage, sigma: number): Promise<GrayscaleImage> {
    return this.blur(input, sigma);
  }
  
  dispose(): void {
    if (!this.resources) return;
    
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