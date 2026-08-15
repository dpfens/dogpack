/**
 * WebGPU-accelerated preprocessing module for XDoG/FDoG
 * 
 * Even faster than WebGL implementations
 */

import {
  type ChannelImage,
  type BilateralFilterConfig,
  type MedianFilterConfig,
  type KuwaharaFilterConfig,
  type EdgeAwareFilterCore,
  DEFAULT_MEDIAN_CONFIG,
  DEFAULT_KUWAHARA_CONFIG,
  DEFAULT_BILATERAL_CONFIG,
  type ContrastEnhancementConfig,
  DEFAULT_CONTRAST_ENHANCEMENT_CONFIG,
  type QuantizerConfig,
  DEFAULT_QUANTIZER_CONFIG,
  type GaussianConfig,
  DEFAULT_GAUSSIAN_CONFIG,
} from '../interfaces/base.js';
import { BaseWebGPUStrategy } from '../base.js';
import BILATERAL_SHADER from './shaders/webgpu/bilateral.wgsl.js';
import KUWAHARA_SHADER from './shaders/webgpu/kuwahara.wgsl.js';
import GAUSSIAN_SHADER from './shaders/webgpu/gaussian.wgsl.js';
import HISTOGRAM_SHADER from './shaders/webgpu/histogram.wgsl.js';
import STRETCH_SHADER from './shaders/webgpu/stretch.wgsl.js';
import QUANTIZE_SHADER from './shaders/webgpu/quantize.wgsl.js';
import MEDIAN_SHADER_TEMPLATE from './shaders/webgpu/median.wgsl.js';
import { isWebGLComputeSupported } from '../utils/device.js';
import { generateGaussianKernel } from '../utils/math.js';

/* ==================================================================== */
/* GPU device management                                                */
/* ==================================================================== */

let cachedDevice: GPUDevice | null = null;
let deviceInitPromise: Promise<GPUDevice> | null = null;

/**
 * Deeper async check: confirms an adapter is actually obtainable, not
 * just that `navigator.gpu` exists.
 */
export async function getWebGPUUnsupportedReason(): Promise<string | undefined> {
  if (typeof navigator === 'undefined' || !(navigator as any).gpu) {
    return 'navigator.gpu is not available in this environment';
  }
  try {
    const adapter = await (navigator as any).gpu.requestAdapter();
    if (!adapter) {
      return 'No suitable GPU adapter was found';
    }
  } catch (err) {
    return `Failed to request a GPU adapter: ${(err as Error).message}`;
  }
  return undefined;
}

async function getWebGPUDevice(): Promise<GPUDevice> {
  if (cachedDevice) return cachedDevice;
  if (deviceInitPromise) return deviceInitPromise;

  deviceInitPromise = (async () => {
    if (!isWebGLComputeSupported()) {
      throw new Error('WebGPU is not supported in this environment (navigator.gpu is missing)');
    }
    const adapter = await (navigator as any).gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to acquire a WebGPU adapter');
    }
    const device: GPUDevice = await adapter.requestDevice();
    device.lost.then((info: GPUDeviceLostInfo) => {
      // Invalidate the cache so the next call reinitializes a fresh device.
      cachedDevice = null;
      deviceInitPromise = null;
      clearShaderCaches(); 
      console.warn(`WebGPU device lost: ${info.message}`);
    });
    cachedDevice = device;
    return device;
  })();

  return deviceInitPromise;
}

/** Release the cached device. Mainly useful for tests / hot reload. */
export function disposeWebGPU(): void {
  cachedDevice?.destroy();
  cachedDevice = null;
  deviceInitPromise = null;
}

/* ==================================================================== */
/* Low-level GPU helpers                                                 */
/* ==================================================================== */

const WORKGROUP_SIZE = 8;

function workgroupCount(size: number): number {
  return Math.ceil(size / WORKGROUP_SIZE);
}

function createUniformBuffer(device: GPUDevice, data: ArrayBuffer): GPUBuffer {
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data));
  buffer.unmap();
  return buffer;
}

function createReadOnlyStorageBuffer(device: GPUDevice, data: Float32Array): GPUBuffer {
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Float32Array(buffer.getMappedRange()).set(data);
  buffer.unmap();
  return buffer;
}

function createOutputStorageBuffer(device: GPUDevice, byteLength: number): GPUBuffer {
  return device.createBuffer({
    size: byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
}

async function readFloat32Buffer(
  device: GPUDevice,
  buffer: GPUBuffer,
  length: number
): Promise<Float32Array> {
  const byteLength = length * 4;
  const staging = device.createBuffer({
    size: byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(buffer, 0, staging, 0, byteLength);
  device.queue.submit([encoder.finish()]);

  await staging.mapAsync(GPUMapMode.READ);
  const copy = new Float32Array(staging.getMappedRange().slice(0));
  staging.unmap();
  staging.destroy();
  return copy;
}

// Shader modules are cached by cacheKey so pipelines that share a module
// (e.g. the two Gaussian blur passes) don't recompile it twice.
const moduleCache = new Map<string, GPUShaderModule>();
const pipelineCache = new Map<string, GPUComputePipeline>();

function getShaderModule(device: GPUDevice, cacheKey: string, code: string): GPUShaderModule {
  let module = moduleCache.get(cacheKey);
  if (!module) {
    module = device.createShaderModule({ code });
    moduleCache.set(cacheKey, module);
  }
  return module;
}

// in webgpu.ts, near moduleCache/pipelineCache
export function clearShaderCaches(): void {
  moduleCache.clear();
  pipelineCache.clear();
}

function getPipeline(
  device: GPUDevice,
  cacheKey: string,
  code: string,
  entryPoint: string
): GPUComputePipeline {
  const key = `${cacheKey}::${entryPoint}`;
  let pipeline = pipelineCache.get(key);
  if (!pipeline) {
    const module = getShaderModule(device, cacheKey, code);
    pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint, constants: { WORKGROUP_SIZE } },
    });
    pipelineCache.set(key, pipeline);
  }
  return pipeline;
}

function dispatch(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  bindGroup: GPUBindGroup,
  width: number,
  height: number
): void {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(workgroupCount(width), workgroupCount(height));
  pass.end();
  device.queue.submit([encoder.finish()]);
}

/* ==================================================================== */
/* Bilateral Filter                                                      */
/* ==================================================================== */

/**
 * The `rowOffset` field lets a single dispatch cover only a band of rows
 * of a much taller image (see the chunking loop in `process()` below).
 * `spatialWeights` is a precomputed (2*radius+1)^2 lookup table for the
 * spatial term of the bilateral weight, which depends only on (dx, dy)
 * and is identical for every pixel. Computing it on the CPU once instead
 * of calling `exp()` for it on every shader invocation roughly halves the
 * transcendental-function work in the inner loop.
 */
export class GPUBilateralFilter extends BaseWebGPUStrategy implements EdgeAwareFilterCore<BilateralFilterConfig> {
  static async isSupported(): Promise<boolean> {
    return isWebGLComputeSupported() && (await getWebGPUUnsupportedReason()) === undefined;
  }
  static getUnsupportedReason(): Promise<string | undefined> {
    return getWebGPUUnsupportedReason();
  }

  async apply(input: ChannelImage, config: Partial<BilateralFilterConfig>): Promise<ChannelImage> {
    const device = await getWebGPUDevice();
    const { width, height } = input;
    const cfg = { ...DEFAULT_BILATERAL_CONFIG, ...config };
    const radius = Math.ceil(cfg.sigmaSpatial * (cfg.radiusMultiplier ?? 2));
    const side = 2 * radius + 1;

    if (radius > 15) {
      console.warn(
        `GPUBilateralFilter: radius=${radius} (from sigmaSpatial=${cfg.sigmaSpatial}) means ` +
          `${side * side} samples/pixel. On large images this can still be expensive enough ` +
          `to run long even chunked; consider a smaller sigmaSpatial/radiusMultiplier if you ` +
          `see slowdowns or device loss.`
      );
    }

    // Precompute the spatial weight term (depends only on dx, dy - identical
    // for every pixel) once on the CPU instead of recomputing it with exp()
    // on every shader invocation for every pixel.
    const spatialLUT = new Float32Array(side * side);
    {
      const sigmaSpatial2 = 2 * cfg.sigmaSpatial * cfg.sigmaSpatial;
      let li = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          spatialLUT[li++] = Math.exp(-(dx * dx + dy * dy) / sigmaSpatial2);
        }
      }
    }

    const uniformData = new ArrayBuffer(32);
    const u32View = new Uint32Array(uniformData);
    const f32View = new Float32Array(uniformData);
    u32View[0] = width;
    u32View[1] = height;
    u32View[2] = radius;
    u32View[3] = 0; // rowOffset - updated per chunk in the loop below
    f32View[4] = 2 * cfg.sigmaSpatial * cfg.sigmaSpatial;
    f32View[5] = 2 * cfg.sigmaRange * cfg.sigmaRange;

    return this.runGuarded(device, async () => {
      const uniformBuffer = createUniformBuffer(device, uniformData);
      const inputBuffer = createReadOnlyStorageBuffer(device, input.data);
      const outputBuffer = createOutputStorageBuffer(device, input.data.byteLength);
      const spatialWeightsBuffer = createReadOnlyStorageBuffer(device, spatialLUT);

      const pipeline = getPipeline(device, 'bilateral', BILATERAL_SHADER, 'main');
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: inputBuffer } },
          { binding: 2, resource: { buffer: outputBuffer } },
          { binding: 3, resource: { buffer: spatialWeightsBuffer } },
        ],
      });

      // Large images combined with large radii make width * height *
      // (2*radius+1)^2 samples in a single dispatch, which can run long
      // enough to exceed the GPU driver's watchdog timeout and bring down
      // the whole device (VK_ERROR_DEVICE_LOST) instead of just failing
      // this operation. Splitting the work into row bands, each submitted
      // and awaited independently, keeps any single submission short.
      // ROWS_PER_CHUNK is sized so that each chunk does roughly the same
      // amount of total sampling work regardless of image width or radius.
      const ROWS_PER_CHUNK = Math.max(1, Math.floor(4_000_000 / (width * side * side)));

      for (let y0 = 0; y0 < height; y0 += ROWS_PER_CHUNK) {
        const rows = Math.min(ROWS_PER_CHUNK, height - y0);
        device.queue.writeBuffer(uniformBuffer, 12, new Uint32Array([y0]));

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(workgroupCount(width), workgroupCount(rows));
        pass.end();
        device.queue.submit([encoder.finish()]);
      }

      const resultData = await readFloat32Buffer(device, outputBuffer, width * height);

      uniformBuffer.destroy();
      inputBuffer.destroy();
      outputBuffer.destroy();
      spatialWeightsBuffer.destroy();

      return { data: resultData, width, height };
    });
  }
}

/* ==================================================================== */
/* Median Filter                                                         */
/* ==================================================================== */


// N (the per-pixel neighborhood size) sizes a function-local `var`, not a
// `var<workgroup>` one, so it can't become a WGSL `override`. The
// override-as-array-size exception only covers workgroup-address-space
// arrays (see median.wgsl's comment for the full explanation). It's a
// genuine `const`, so it still has to be baked per radius at the string
// level; a new shader module is compiled (and cached by getPipeline's
// cacheKey) for each distinct radius, same as before this migration.
function medianShaderSource(radius: number): string {
  const side = 2 * radius + 1;
  const n = side * side;
  return MEDIAN_SHADER_TEMPLATE.replace('__N__', String(n));
}

export class GPUMedianFilter extends BaseWebGPUStrategy implements EdgeAwareFilterCore<MedianFilterConfig> {
  static async isSupported(): Promise<boolean> {
    return isWebGLComputeSupported() && (await getWebGPUUnsupportedReason()) === undefined;
  }
  static getUnsupportedReason(): Promise<string | undefined> {
    return getWebGPUUnsupportedReason();
  }

  async apply(input: ChannelImage, config: Partial<MedianFilterConfig>): Promise<ChannelImage> {
    const cfg = { ...DEFAULT_MEDIAN_CONFIG, ...config };
    if (cfg.radius > 6) {
      console.warn(
        `GPUMedianFilter: radius=${cfg.radius} means a per-pixel ` +
          `neighborhood array of ${(2 * cfg.radius + 1) ** 2} elements, ` +
          `sorted in-shader with an O(n^2) insertion sort. This can get slow ` +
          `and register-heavy fast; consider a smaller radius on GPU.`
      );
    }

    const device = await getWebGPUDevice();
    const { width, height } = input;
    const radius = cfg.radius;

    const uniformData = new ArrayBuffer(16);
    const u32View = new Uint32Array(uniformData);
    u32View[0] = width;
    u32View[1] = height;
    u32View[2] = radius;

    return this.runGuarded(device, async () => {
      const uniformBuffer = createUniformBuffer(device, uniformData);
      const inputBuffer = createReadOnlyStorageBuffer(device, input.data);
      const outputBuffer = createOutputStorageBuffer(device, input.data.byteLength);

      const cacheKey = `median-r${radius}`;
      const pipeline = getPipeline(device, cacheKey, medianShaderSource(radius), 'main');
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: inputBuffer } },
          { binding: 2, resource: { buffer: outputBuffer } },
        ],
      });

      dispatch(device, pipeline, bindGroup, width, height);
      const resultData = await readFloat32Buffer(device, outputBuffer, width * height);

      uniformBuffer.destroy();
      inputBuffer.destroy();
      outputBuffer.destroy();

      return { data: resultData, width, height };
    });
  }
}

/* ==================================================================== */
/* Kuwahara Filter                                                       */
/* ==================================================================== */

export class GPUKuwaharaFilter extends BaseWebGPUStrategy implements EdgeAwareFilterCore<KuwaharaFilterConfig> {
  static async isSupported(): Promise<boolean> {
    return isWebGLComputeSupported() && (await getWebGPUUnsupportedReason()) === undefined;
  }
  static getUnsupportedReason(): Promise<string | undefined> {
    return getWebGPUUnsupportedReason();
  }

  async apply(input: ChannelImage, config: Partial<KuwaharaFilterConfig>): Promise<ChannelImage> {
    const cfg = { ...DEFAULT_KUWAHARA_CONFIG, ...config };
    const device = await getWebGPUDevice();
    const { width, height } = input;
    const radius = cfg.radius;

    const uniformData = new ArrayBuffer(16);
    const u32View = new Uint32Array(uniformData);
    u32View[0] = width;
    u32View[1] = height;
    u32View[2] = radius;

    return this.runGuarded(device, async () => {
      const uniformBuffer = createUniformBuffer(device, uniformData);
      const inputBuffer = createReadOnlyStorageBuffer(device, input.data);
      const outputBuffer = createOutputStorageBuffer(device, input.data.byteLength);

      const pipeline = getPipeline(device, 'kuwahara', KUWAHARA_SHADER, 'main');
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: inputBuffer } },
          { binding: 2, resource: { buffer: outputBuffer } },
        ],
      });

      dispatch(device, pipeline, bindGroup, width, height);
      const resultData = await readFloat32Buffer(device, outputBuffer, width * height);

      uniformBuffer.destroy();
      inputBuffer.destroy();
      outputBuffer.destroy();

      return { data: resultData, width, height };
    });
  }
}

/* ==================================================================== */
/* Gaussian Blur (separable, two compute passes)                        */
/* ==================================================================== */

export class GPUGaussianBlur extends BaseWebGPUStrategy implements EdgeAwareFilterCore<GaussianConfig> {
  static async isSupported(): Promise<boolean> {
    return isWebGLComputeSupported() && (await getWebGPUUnsupportedReason()) === undefined;
  }
  static getUnsupportedReason(): Promise<string | undefined> {
    return getWebGPUUnsupportedReason();
  }

  async apply(input: ChannelImage, config: Partial<GaussianConfig>): Promise<ChannelImage> {
    const { width, height } = input;
    const cfg = {...DEFAULT_GAUSSIAN_CONFIG, ...config};
    if (cfg.sigma < 0.1) {
      return { data: new Float32Array(input.data), width, height };
    }

    const device = await getWebGPUDevice();
    const radius = Math.ceil(cfg.sigma * 3);
    const kernelSize = radius * 2 + 1;
    const kernel = generateGaussianKernel(cfg.sigma, kernelSize);

    const uniformData = new ArrayBuffer(16);
    const u32View = new Uint32Array(uniformData);
    u32View[0] = width;
    u32View[1] = height;
    u32View[2] = radius;

    return this.runGuarded(device, async () => {
      const uniformBuffer = createUniformBuffer(device, uniformData);
      const inputBuffer = createReadOnlyStorageBuffer(device, input.data);
      const kernelBuffer = createReadOnlyStorageBuffer(device, new Float32Array(kernel));
      const tempBuffer = createOutputStorageBuffer(device, input.data.byteLength);
      const outputBuffer = createOutputStorageBuffer(device, input.data.byteLength);

      const pipelineH = getPipeline(device, 'gaussian', GAUSSIAN_SHADER, 'main_h');
      const pipelineV = getPipeline(device, 'gaussian', GAUSSIAN_SHADER, 'main_v');

      const bindGroupH = device.createBindGroup({
        layout: pipelineH.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: inputBuffer } },
          { binding: 2, resource: { buffer: kernelBuffer } },
          { binding: 3, resource: { buffer: tempBuffer } },
        ],
      });
      const bindGroupV = device.createBindGroup({
        layout: pipelineV.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: tempBuffer } },
          { binding: 2, resource: { buffer: kernelBuffer } },
          { binding: 3, resource: { buffer: outputBuffer } },
        ],
      });

      // Both passes are recorded on one command encoder before submission,
      // so the vertical pass reliably waits for the horizontal pass's writes
      // to tempBuffer (WebGPU commands within one queue submission execute
      // in program order with respect to buffer dependencies).
      const encoder = device.createCommandEncoder();

      let pass = encoder.beginComputePass();
      pass.setPipeline(pipelineH);
      pass.setBindGroup(0, bindGroupH);
      pass.dispatchWorkgroups(workgroupCount(width), workgroupCount(height));
      pass.end();

      pass = encoder.beginComputePass();
      pass.setPipeline(pipelineV);
      pass.setBindGroup(0, bindGroupV);
      pass.dispatchWorkgroups(workgroupCount(width), workgroupCount(height));
      pass.end();

      device.queue.submit([encoder.finish()]);

      const resultData = await readFloat32Buffer(device, outputBuffer, width * height);

      uniformBuffer.destroy();
      inputBuffer.destroy();
      kernelBuffer.destroy();
      tempBuffer.destroy();
      outputBuffer.destroy();

      return { data: resultData, width, height };
    });
  }
}

/* ==================================================================== */
/* Contrast Enhancement (histogram-based percentile approximation)      */
/* ==================================================================== */

export class GPUContrastEnhancer extends BaseWebGPUStrategy implements EdgeAwareFilterCore<ContrastEnhancementConfig> {
  static async isSupported(): Promise<boolean> {
    return isWebGLComputeSupported() && (await getWebGPUUnsupportedReason()) === undefined;
  }
  static getUnsupportedReason(): Promise<string | undefined> {
    return getWebGPUUnsupportedReason();
  }

  /**
   * The CPU version sorts every pixel to find exact percentiles. Sorting
   * is a poor fit for a GPU compute pass, so this builds a 256-bin
   * histogram instead (one atomicAdd per pixel), reads the 1KB histogram
   * back to the CPU to locate the percentile bins, then runs a second,
   * fully GPU-resident pass to apply the stretch. This trades a small
   * amount of precision (bin width 1/255) for O(n) work instead of an
   * O(n log n) sort, at the cost of one small CPU/GPU sync point.
   *
   * The two GPU round-trips (histogram pass, then stretch pass) are each
   * wrapped in their own runGuarded scope rather than one scope spanning
   * both. The CPU-side histogram bucketing that happens between them
   * isn't GPU work, so it shouldn't sit inside a WebGPU error scope.
   */
  async apply(input: ChannelImage, config: Partial<ContrastEnhancementConfig>): Promise<ChannelImage> {
    const { blackPoint, whitePoint } = {...DEFAULT_CONTRAST_ENHANCEMENT_CONFIG, ...config};
    const device = await getWebGPUDevice();
    const { width, height } = input;
    const size = width * height;

    const histUniform = new ArrayBuffer(16);
    new Uint32Array(histUniform).set([width, height, 0, 0]);

    const histogramU32 = await this.runGuarded(device, async () => {
      const histUniformBuffer = createUniformBuffer(device, histUniform);
      const histInputBuffer = createReadOnlyStorageBuffer(device, input.data);

      const histogramBuffer = device.createBuffer({
        size: 256 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(histogramBuffer, 0, new Uint32Array(256));

      const histPipeline = getPipeline(device, 'histogram', HISTOGRAM_SHADER, 'main');
      const histBindGroup = device.createBindGroup({
        layout: histPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: histUniformBuffer } },
          { binding: 1, resource: { buffer: histInputBuffer } },
          { binding: 2, resource: { buffer: histogramBuffer } },
        ],
      });

      dispatch(device, histPipeline, histBindGroup, width, height);
      const result = await readUint32Buffer(device, histogramBuffer, 256);

      histUniformBuffer.destroy();
      histInputBuffer.destroy();
      histogramBuffer.destroy();

      return result;
    });

    const blackCount = blackPoint * size;
    const whiteCount = whitePoint * size;
    let cumulative = 0;
    let minBin = 0;
    let maxBin = 255;
    let foundMin = false;
    for (let bin = 0; bin < 256; bin++) {
      cumulative += histogramU32[bin];
      if (!foundMin && cumulative >= blackCount) {
        minBin = bin;
        foundMin = true;
      }
      if (cumulative >= whiteCount) {
        maxBin = bin;
        break;
      }
    }

    const minVal = minBin / 255;
    const maxVal = maxBin / 255;
    const range = maxVal - minVal;

    if (range < 0.01) {
      return { data: new Float32Array(input.data), width, height };
    }

    const stretchUniform = new ArrayBuffer(16);
    const stretchU32 = new Uint32Array(stretchUniform);
    const stretchF32 = new Float32Array(stretchUniform);
    stretchU32[0] = width;
    stretchU32[1] = height;
    stretchF32[2] = minVal;
    stretchF32[3] = range;

    return this.runGuarded(device, async () => {
      const stretchUniformBuffer = createUniformBuffer(device, stretchUniform);
      const stretchInputBuffer = createReadOnlyStorageBuffer(device, input.data);
      const outputBuffer = createOutputStorageBuffer(device, input.data.byteLength);

      const stretchPipeline = getPipeline(device, 'stretch', STRETCH_SHADER, 'main');
      const stretchBindGroup = device.createBindGroup({
        layout: stretchPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: stretchUniformBuffer } },
          { binding: 1, resource: { buffer: stretchInputBuffer } },
          { binding: 2, resource: { buffer: outputBuffer } },
        ],
      });

      dispatch(device, stretchPipeline, stretchBindGroup, width, height);
      const resultData = await readFloat32Buffer(device, outputBuffer, width * height);

      stretchUniformBuffer.destroy();
      stretchInputBuffer.destroy();
      outputBuffer.destroy();

      return { data: resultData, width, height };
    });
  }
}

async function readUint32Buffer(
  device: GPUDevice,
  buffer: GPUBuffer,
  length: number
): Promise<Uint32Array> {
  const byteLength = length * 4;
  const staging = device.createBuffer({
    size: byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(buffer, 0, staging, 0, byteLength);
  device.queue.submit([encoder.finish()]);

  await staging.mapAsync(GPUMapMode.READ);
  const copy = new Uint32Array(staging.getMappedRange().slice(0));
  staging.unmap();
  staging.destroy();
  return copy;
}

/* ==================================================================== */
/* Quantizer                                                             */
/* ==================================================================== */

export class GPUQuantizer extends BaseWebGPUStrategy implements EdgeAwareFilterCore<QuantizerConfig> {
  static async isSupported(): Promise<boolean> {
    return isWebGLComputeSupported() && (await getWebGPUUnsupportedReason()) === undefined;
  }
  static getUnsupportedReason(): Promise<string | undefined> {
    return getWebGPUUnsupportedReason();
  }

  async apply(input: ChannelImage, config: Partial<QuantizerConfig>): Promise<ChannelImage> {
    const cfg = {...DEFAULT_QUANTIZER_CONFIG, ...config};
    const device = await getWebGPUDevice();
    const { width, height } = input;
    const step = 1 / (cfg.levels - 1);

    const uniformData = new ArrayBuffer(16);
    const u32View = new Uint32Array(uniformData);
    const f32View = new Float32Array(uniformData);
    u32View[0] = width;
    u32View[1] = height;
    f32View[2] = step;

    return this.runGuarded(device, async () => {
      const uniformBuffer = createUniformBuffer(device, uniformData);
      const inputBuffer = createReadOnlyStorageBuffer(device, input.data);
      const outputBuffer = createOutputStorageBuffer(device, input.data.byteLength);

      const pipeline = getPipeline(device, 'quantize', QUANTIZE_SHADER, 'main');
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: inputBuffer } },
          { binding: 2, resource: { buffer: outputBuffer } },
        ],
      });

      dispatch(device, pipeline, bindGroup, width, height);
      const resultData = await readFloat32Buffer(device, outputBuffer, width * height);

      uniformBuffer.destroy();
      inputBuffer.destroy();
      outputBuffer.destroy();

      return { data: resultData, width, height };
    });
  }
}

/* ==================================================================== */
/* Presets and pipeline (async-native equivalents of cpu.ts's)           */
/* ==================================================================== */

/**
 * Preset preprocessing pipelines for common use cases.
 * async GPU equivalents of `PreprocessingPresets` in cpu.ts.
 */
export const GPUPreprocessingPresets = {
  /** Light preprocessing - minimal smoothing. Good for clean studio photos, illustrations. */
  light: (input: ChannelImage): Promise<ChannelImage> =>
    new GPUBilateralFilter().apply(input, { sigmaSpatial: 2, sigmaRange: 0.08 }),

  /** Standard preprocessing - balanced smoothing. Good for most outdoor photos, portraits. */
  standard: (input: ChannelImage): Promise<ChannelImage> =>
    new GPUBilateralFilter().apply(input, { sigmaSpatial: 4, sigmaRange: 0.1 }),

  /** Heavy preprocessing - aggressive noise removal. Good for very textured images. */
  heavy: async (input: ChannelImage): Promise<ChannelImage> => {
    let result = await new GPUBilateralFilter().apply(input, { sigmaSpatial: 5, sigmaRange: 0.12 });
    result = await new GPUBilateralFilter().apply(result, { sigmaSpatial: 3, sigmaRange: 0.1 });
    return result;
  },

  /** Artistic preprocessing - painterly smoothing. Good for stylized/artistic output. */
  artistic: async (input: ChannelImage): Promise<ChannelImage> => {
    let result = await new GPUKuwaharaFilter().apply(input, { radius: 4 });
    result = await new GPUBilateralFilter().apply(result, { sigmaSpatial: 2, sigmaRange: 0.08 });
    return result;
  },

  /** Photo preprocessing - for photos with grass/nature. Good for landscape, outdoor scenes. */
  nature: async (input: ChannelImage): Promise<ChannelImage> => {
    let result = await new GPUBilateralFilter().apply(input, { sigmaSpatial: 6, sigmaRange: 0.15 });
    result = await new GPUBilateralFilter().apply(result, { sigmaSpatial: 3, sigmaRange: 0.08 });
    return result;
  },
};
