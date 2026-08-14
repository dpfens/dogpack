/**
 * Blur strategies for DoG processing
 * 
 * Provides both isotropic (standard) and anisotropic (flow-guided) blur
 * implementations for use in XDoG and FDoG pipelines.
 * 
 * Supports parallel/concurrent blur operations
 */

import type { BlurStrategy, BlurStrategyCtor, ChannelImage } from '../interfaces/base.js';
import {
  createChannelImage,
  getPixel,
} from '../utils/image.js';
import {
  isWebGLComputeSupported,
  isWebGPUSupported,
} from '../utils/device.js';
import { BaseCPUStrategy, BaseWebGLStrategy, BaseWebGPUStrategy } from '../base.js';
import VERTEX_SHADER_SOURCE from '../shaders/vertex-shader.wgsl.js'
import WEBGL2_HORIZONTAL_BLUE_SOURCE from './shaders/isotropic/webgl-horizontal-blur.glsl.js'
import WEBGL2_VERTICAL_BLUE_SOURCE from './shaders/isotropic/webgl-vertical-blur.glsl.js'
import WEBGPU_HORIZONTAL_BLUE_SOURCE from './shaders/isotropic/webgpu-horizontal-blur.wgsl.js'
import WEBGPU_VERTICAL_BLUE_SOURCE from './shaders/isotropic/webgpu-vertical-blur.wgsl.js'
import { generateGaussianKernel } from '../utils/math.js';

/**
 * Configuration for isotropic Gaussian blur
 */
export interface BaseIsotropicBlurConfig {
  /** 
   * Kernel size multiplier relative to sigma (default: 6, meaning 3 * sigma on each side)
   * Paper samples at 2x sigma for flow-aligned, 2.45x for structure tensor
   */
  kernelSizeMultiplier: number;
}

const DEFAULT_ISOTROPIC_CONFIG: BaseIsotropicBlurConfig = {
  kernelSizeMultiplier: 6,
};

/**
 * Configuration for flow-guided blur
 */
export interface FlowGuidedBlurConfig {
  /** 
   * Kernel size multiplier for flow-aligned LIC (default: 6)
   */
  kernelSizeMultiplier: number;
  
  /**
   * Step size for line integral convolution (default: 1.0)
   * Smaller values give smoother integration but cost more
   */
  stepSize: number;
}

/**
 * Compute kernel size from sigma
 * Paper samples at all integer locations less than 2x sigma for flow-aligned,
 * and extends to 2.45 * sigma for structure tensor blur
 * 
 * @param sigma Standard deviation
 * @param multiplier Size multiplier (default 6 = 3*sigma on each side)
 */
function computeKernelSize(sigma: number, multiplier: number = 6): number {
  // Ensure odd size for symmetric kernel
  return Math.max(3, Math.floor(sigma * multiplier) | 1);
}

/**
 * Standard isotropic Gaussian blur using separable convolution
 * This is the blur used in basic XDoG
 */
export class CPUIsotropicBlur extends BaseCPUStrategy implements BlurStrategy {
  private config: BaseIsotropicBlurConfig;
  
  constructor(config: Partial<BaseIsotropicBlurConfig> = {}) {
    super();
    this.config = { ...DEFAULT_ISOTROPIC_CONFIG, ...config };
  }

  /** CPU is always available */
  static async isSupported(): Promise<boolean> {
    return true;
  }

  dispose(): void {}
  
  async blur(input: ChannelImage, sigma: number): Promise<ChannelImage> {
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


/**
 * WebGL context and resource management
 */
interface WebGLResources {
  gl: WebGL2RenderingContext;
  canvas: OffscreenCanvas | HTMLCanvasElement;
  horizontalBlurProgram: WebGLProgram;
  verticalBlurProgram: WebGLProgram;
  quadBuffer: WebGLBuffer;
  texCoordBuffer: WebGLBuffer;
}


/**
 * Compile a WebGL2 shader
 */
function compileShader(
  gl: WebGL2RenderingContext,
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
 * Create a WebGL2 program from vertex and fragment shaders
 */
function createProgram(
  gl: WebGL2RenderingContext,
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
 * WebGL2-accelerated isotropic Gaussian blur
 * Uses separable convolution with two passes (horizontal + vertical)
 */
export class WebGLIsotropicBlur extends BaseWebGLStrategy implements BlurStrategy {
  private config: WebGLBlurConfig;
  // Only the compiled programs + static geometry buffers are cached on the
  // instance now. These are immutable/read-only once created, so sharing
  // them across calls is safe. Textures and the framebuffer -- the pieces
  // that are actually mutated during a blur -- are allocated fresh inside
  // blur() below (see comment there).
  private resources: WebGLResources | null = null;

  constructor(config: Partial<WebGLBlurConfig> = {}) {
    super();
    this.config = { ...DEFAULT_WEBGL_CONFIG, ...config };
  }

  /**
   * Cheap synchronous-in-spirit check (wrapped in a resolved Promise to
   * satisfy `BlurStrategyCtor`) Excludes software
   * rasterizers, which are too slow to be a useful GPU fallback.
   */
  static async isSupported(): Promise<boolean> {
    return isWebGLComputeSupported();
  }
  
  private initResources(canvas: OffscreenCanvas | HTMLCanvasElement): WebGLResources {
    if (this.resources) return this.resources;
    
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) {
      throw new Error('WebGL2 not supported');
    }
    
    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );
    
    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      gl.STATIC_DRAW
    );
    
    const horizontalBlurProgram = createProgram(gl, VERTEX_SHADER_SOURCE, WEBGL2_HORIZONTAL_BLUE_SOURCE);
    const verticalBlurProgram = createProgram(gl, VERTEX_SHADER_SOURCE, WEBGL2_VERTICAL_BLUE_SOURCE);
    
    this.resources = {
      gl,
      canvas,
      horizontalBlurProgram,
      verticalBlurProgram,
      quadBuffer: quadBuffer!,
      texCoordBuffer: texCoordBuffer!,
    };
    
    return this.resources;
  }
  
  /**
   * Textures and the framebuffer are allocated per-call (not cached on
   * `this`) so concurrent blur() calls on the same instance -- e.g.
   * DoGProcessor.process()'s Promise.all([blur(sigma), blur(sigma*k)]) --
   * never share mutable GPU state. Mirrors the pattern already used by
   * WebGPUIsotropicBlur. Always cleaned up in `finally`, even if a pass or
   * readback throws.
   */
  async blur(input: ChannelImage, sigma: number): Promise<ChannelImage> {
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
    
    const kernelSize = Math.min(
      this.config.maxKernelSize,
      Math.max(3, Math.floor(sigma * this.config.kernelSizeMultiplier) | 1)
    );
    const kernel = generateGaussianKernel(sigma, kernelSize);

    const textures: WebGLTexture[] = [];
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) {
      throw new Error('Failed to create framebuffer');
    }

    try {
      for (let i = 0; i < 3; i++) {
        const texture = gl.createTexture();
        if (!texture) {
          throw new Error('Failed to create texture');
        }
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        textures.push(texture);
      }

      // Upload input data
      gl.bindTexture(gl.TEXTURE_2D, textures[0]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.FLOAT, input.data);

      // Horizontal blur
      this.blurPass(resources, framebuffer, textures[0], textures[1], kernel, kernelSize, width, height, true);

      // Vertical blur
      this.blurPass(resources, framebuffer, textures[1], textures[2], kernel, kernelSize, width, height, false);

      // Read back result
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textures[2], 0);
      const resultData = new Float32Array(width * height);
      gl.readPixels(0, 0, width, height, gl.RED, gl.FLOAT, resultData);

      return {
        data: resultData,
        width,
        height,
      };
    } finally {
      textures.forEach(t => gl.deleteTexture(t));
      gl.deleteFramebuffer(framebuffer);
    }
  }
  
  private blurPass(
    resources: WebGLResources,
    framebuffer: WebGLFramebuffer,
    inputTexture: WebGLTexture,
    outputTexture: WebGLTexture,
    kernel: Float32Array,
    kernelSize: number,
    width: number,
    height: number,
    isHorizontal: boolean
  ): void {
    const { gl, quadBuffer, texCoordBuffer } = resources;
    const program = isHorizontal ? resources.horizontalBlurProgram : resources.verticalBlurProgram;
    
    gl.useProgram(program);
    gl.viewport(0, 0, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outputTexture, 0);
    
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
    gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), width, height);
    gl.uniform1fv(gl.getUniformLocation(program, 'u_kernel'), kernel);
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
  
  dispose(): void {
    if (this.resources) {
      const { gl } = this.resources;
      gl.deleteProgram(this.resources.horizontalBlurProgram);
      gl.deleteProgram(this.resources.verticalBlurProgram);
      gl.deleteBuffer(this.resources.quadBuffer);
      gl.deleteBuffer(this.resources.texCoordBuffer);
    }
    
    this.resources = null;
  }
}

/**
 * WebGPU configuration
 */
export interface WebGPUBlurConfig {
  /** Kernel size multiplier relative to sigma (default: 6) */
  kernelSizeMultiplier: number;
  /** Maximum kernel size (default: 63) */
  maxKernelSize: number;
}

const DEFAULT_WEBGPU_CONFIG: WebGPUBlurConfig = {
  kernelSizeMultiplier: 6,
  maxKernelSize: 63,
};

/**
 * WebGPU resources
 */
interface WebGPUResources {
  device: GPUDevice;
  horizontalPipeline: GPUComputePipeline;
  verticalPipeline: GPUComputePipeline;
  bindGroupLayout: GPUBindGroupLayout;
}

/**
 * WebGPU-accelerated isotropic Gaussian blur
 * Uses compute shaders with separable convolution
 * 
 * Supports concurrent/parallel blur calls by creating
 * separate staging buffers for each operation instead of reusing one.
 */
export class WebGPUIsotropicBlur extends BaseWebGPUStrategy implements BlurStrategy {
  private config: WebGPUBlurConfig;
  private resources: WebGPUResources | null = null;
  
  constructor(config: Partial<WebGPUBlurConfig> = {}) {
    super();
    this.config = { ...DEFAULT_WEBGPU_CONFIG, ...config };
  }

  /**
   * Confirms an adapter is actually obtainable, not just that
   * `navigator.gpu` exists as an API surface.
   */
  static async isSupported(): Promise<boolean> {
    return isWebGPUSupported();
  }
  
  /**
   * Initialize WebGPU resources
   */
  private async initResources(): Promise<WebGPUResources> {
    if (this.resources) return this.resources;
    
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
        module: device.createShaderModule({ code: WEBGPU_HORIZONTAL_BLUE_SOURCE }),
        entryPoint: 'main',
      },
    });
    
    const verticalPipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: {
        module: device.createShaderModule({ code: WEBGPU_VERTICAL_BLUE_SOURCE }),
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
  async blur(input: ChannelImage, sigma: number): Promise<ChannelImage> {
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

    const kernelSize = Math.min(
      this.config.maxKernelSize,
      Math.max(3, Math.floor(sigma * this.config.kernelSizeMultiplier) | 1)
    );
    const kernel = generateGaussianKernel(sigma, kernelSize);

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
    } finally {
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
  dispose(): void {}
}


export type IsotropicBlurConfig = BaseIsotropicBlurConfig | WebGLBlurConfig | WebGPUBlurConfig

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
export class IsotropicBlur implements BlurStrategy {
  private failedBackends = new Set<BlurStrategyCtor>();

  private constructor(
    private instance: BlurStrategy,
    private currentCtor: BlurStrategyCtor,
    private config: Partial<IsotropicBlurConfig>
  ) {}

  // Ordered best-to-worst. `satisfies` (not `implements`) catches a
  // backend missing isSupported() or the instance shape at this line,
  // rather than failing silently or only at a call site deep inside.
  private static readonly candidates = [
    WebGPUIsotropicBlur,
    WebGLIsotropicBlur,
    CPUIsotropicBlur,
  ] satisfies BlurStrategyCtor[];

  static async create(config: Partial<IsotropicBlurConfig> = {}): Promise<IsotropicBlur> {
    for (const Ctor of IsotropicBlur.candidates) {
      if (await Ctor.isSupported()) {
        try {
          return new IsotropicBlur(new Ctor(config), Ctor, config);
        } catch {
          continue; // isSupported() lied; try the next candidate
        }
      }
    }
    throw new Error('No supported blur implementation available');
  }

  get backend() {
    return this.instance.backend;
  }

  dispose(): void {
    this.instance.dispose();
  }

  async blur(input: ChannelImage, sigma: number): Promise<ChannelImage> {
    let current = this.instance;
    while (true) {
      try {
        console.log(`${this.constructor.name}: Running ${current.backend}`);
        return await current.blur(input, sigma);
      } catch (err) {
        console.warn(`${this.constructor.name}: [${this.currentCtor.name}] process() failed, attempting fallback:`, err);
        const fallback = await this.demoteAndFindNext();
        if (!fallback) throw err;
        current = fallback;
      }
    }
  }

  /**
   * Demotes the current backend and activates the next untried, supported
   * candidate. A single-step retry, not a cascading loop through every
   * remaining backend: cascading on one call risks masking a real input
   * bug (e.g. a bad sigma) as a backend problem.
   *
   * `failedBackends` is per-instance, not module-global so a transient
   * driver hiccup shouldn't permanently blacklist a backend for the whole
   * session.
   */
  private async demoteAndFindNext(): Promise<BlurStrategy | null> {
    this.failedBackends.add(this.currentCtor);
    this.instance.dispose();
    for (const Ctor of IsotropicBlur.candidates) {
      if (this.failedBackends.has(Ctor)) continue;
      if (await Ctor.isSupported()) {
        try {
          this.instance = new Ctor(this.config);
          this.currentCtor = Ctor;
          console.warn(`Falling back to ${Ctor.name}`);
          return this.instance;
        } catch (err) {
          console.warn(`[${Ctor.name}] construction failed despite isSupported():`, err);
          this.failedBackends.add(Ctor);
        }
      }
    }
    return null;
  }
}