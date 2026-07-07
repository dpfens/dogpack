/**
 * Blur strategies for DoG processing
 * 
 * Provides both isotropic (standard) and anisotropic (flow-guided) blur
 * implementations for use in XDoG and FDoG pipelines.
 * 
 * FIXED: WebGPUIsotropicBlur now supports parallel/concurrent blur operations
 */

import type { BlurStrategy, ChannelImage } from '../types.js';
import { createChannelImage, getPixel,  generateGaussianKernel, computeKernelSize } from '../utils/index.js';
import { BaseCPUBlur, BaseWebGLBlur, BaseWebGPUBlur } from './base.js';

/**
 * Configuration for isotropic Gaussian blur
 */
export interface BaseIsotropicBlurConfig {
  /** 
   * Kernel size multiplier relative to sigma (default: 6, meaning 3σ on each side)
   * Paper samples at 2× sigma for flow-aligned, 2.45× for structure tensor
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
 * Standard isotropic Gaussian blur using separable convolution
 * This is the blur used in basic XDoG
 */
export class CPUIsotropicBlur extends BaseCPUBlur implements BlurStrategy {
  private config: BaseIsotropicBlurConfig;
  
  constructor(config: Partial<BaseIsotropicBlurConfig> = {}) {
    super();
    this.config = { ...DEFAULT_ISOTROPIC_CONFIG, ...config };
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
 * Vertex shader for WebGL2 - simple fullscreen quad
 */
const VERTEX_SHADER = `#version 300 es
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
export class WebGLIsotropicBlur extends BaseWebGLBlur implements BlurStrategy {
  private config: WebGLBlurConfig;
  private resources: WebGLResources | null = null;
  private currentWidth = 0;
  private currentHeight = 0;
  private framebuffer: WebGLFramebuffer | null = null;
  private textures: WebGLTexture[] = [];
  
  constructor(config: Partial<WebGLBlurConfig> = {}) {
    super();
    this.config = { ...DEFAULT_WEBGL_CONFIG, ...config };
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
    
    const horizontalBlurProgram = createProgram(gl, VERTEX_SHADER, HORIZONTAL_BLUR_SHADER);
    const verticalBlurProgram = createProgram(gl, VERTEX_SHADER, VERTICAL_BLUR_SHADER);
    
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
        this.textures.push(texture!);
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
  
  private blurPass(
    resources: WebGLResources,
    inputTexture: WebGLTexture,
    outputTexture: WebGLTexture,
    kernel: Float32Array,
    kernelSize: number,
    isHorizontal: boolean
  ): void {
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
  
  dispose(): void {
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
export class WebGPUIsotropicBlur extends BaseWebGPUBlur implements BlurStrategy {
  private config: WebGPUBlurConfig;
  private resources: WebGPUResources | null = null;
  
  // Reusable buffers for compute operations
  private paramsBuffer: GPUBuffer | null = null;
  private kernelBuffer: GPUBuffer | null = null;
  private inputBuffer: GPUBuffer | null = null;
  private tempBuffer: GPUBuffer | null = null;
  private outputBuffer: GPUBuffer | null = null;
  private currentBufferSize = 0;
  private currentKernelSize = 0;
  
  constructor(config: Partial<WebGPUBlurConfig> = {}) {
    super();
    this.config = { ...DEFAULT_WEBGPU_CONFIG, ...config };
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
  private ensureBuffers(device: GPUDevice, pixelCount: number, kernelSize: number): void {
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
    
    // Compute kernel
    const kernelSize = Math.min(
      this.config.maxKernelSize,
      Math.max(3, Math.floor(sigma * this.config.kernelSizeMultiplier) | 1)
    );
    const kernel = generateGaussianKernel(sigma, kernelSize);
    
    // Ensure buffers
    this.ensureBuffers(device, pixelCount, kernelSize);
    
    // Upload data
    device.queue.writeBuffer(this.paramsBuffer!, 0, new Uint32Array([width, height, kernelSize, 0]));
    device.queue.writeBuffer(this.kernelBuffer!, 0, new Float32Array(kernel));
    device.queue.writeBuffer(this.inputBuffer!, 0, new Float32Array(input.data));
    
    // Create bind groups
    const horizontalBindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer! } },
        { binding: 1, resource: { buffer: this.kernelBuffer! } },
        { binding: 2, resource: { buffer: this.inputBuffer! } },
        { binding: 3, resource: { buffer: this.tempBuffer! } },
      ],
    });
    
    const verticalBindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer! } },
        { binding: 1, resource: { buffer: this.kernelBuffer! } },
        { binding: 2, resource: { buffer: this.tempBuffer! } },
        { binding: 3, resource: { buffer: this.outputBuffer! } },
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
    commandEncoder.copyBufferToBuffer(
      this.outputBuffer!,
      0,
      stagingBuffer,
      0,
      pixelCount * 4
    );
    
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
  dispose(): void {
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


export type IsotropicBlurConfig = BaseIsotropicBlurConfig | WebGLBlurConfig | WebGPUBlurConfig

export class IsotropicBlur implements BlurStrategy {
    instance: BlurStrategy;
    
    constructor(config: Partial<IsotropicBlurConfig>) {
        if (WebGPUIsotropicBlur.isSupported()) {
            this.instance = new WebGPUIsotropicBlur(config);
        }
        else if (WebGLIsotropicBlur.isSupported()) {
            this.instance = new WebGLIsotropicBlur(config);
        } else {
            this.instance = new CPUIsotropicBlur(config);
        }
    }

    dispose(): void {
      this.instance.dispose();
    }

    async blur(input: ChannelImage, sigma: number): Promise<ChannelImage> {
        return this.instance.blur(input, sigma);
    }
}