/**
 * WebGPU-accelerated Edge Tangent Flow computation
 *
 * Functional port of the WebGL2 implementation (webgl.ts) onto WebGPU
 * compute shaders. Structurally this is much simpler than the WebGL version:
 * there's no canvas, no framebuffers, and no fragment-shader ping-pong —
 * every stage is a compute pass over flat storage buffers, addressed by
 * (y * width + x) instead of texture coordinates. Edge-clamping is done
 * manually via clampIdx() rather than relying on CLAMP_TO_EDGE sampler state.
 *
 * NOTE: like the WebGL version's fixed `u_kernel[33]` uniform array (which
 * capped the Gaussian blur radius at 16), the WebGL implementation had to
 * work around GLSL's lack of dynamically-sized arrays. Storage buffers have
 * no such limit here, so the blur radius is only bounded by sanity/perf
 * limits, not by shader syntax — see MAX_BLUR_RADIUS below.
 */

import { type ChannelImage, type FlowField, type Vec2, type ETFConfig, DEFAULT_ETF_CONFIG } from '../types.js';
import { createChannelImage } from '../utils/index.js';

// NOTE: isWebGPUComputeSupported() isn't assumed to exist in utils/index.js
// yet (only isWebGLComputeSupported is referenced in webgl.ts), so a local
// equivalent is defined at the bottom of this file. Feel free to hoist it
// into utils/index.js as a sibling of isWebGLComputeSupported.

/** Sanity cap on Gaussian blur radius (pixels). Not a shader limitation —
 *  just guards against pathological sigma values blowing up dispatch cost. */
const MAX_BLUR_RADIUS = 64;

const WORKGROUP_SIZE = 8;

/**
 * Cached WebGPU device + compiled pipelines. Unlike the WebGL resources,
 * none of this depends on image width/height, so it's created once and
 * reused for every compute() call regardless of resolution.
 */
interface WebGPUResources {
  device: GPUDevice;
  gradientPipeline: GPUComputePipeline;
  structureTensorPipeline: GPUComputePipeline;
  blurHPipeline: GPUComputePipeline;
  blurVPipeline: GPUComputePipeline;
  tangentExtractPipeline: GPUComputePipeline;
  tangentRefinePipeline: GPUComputePipeline;
  /** Whether the device supports 'timestamp-query', enabling per-pass GPU
   *  profiling in compute(). Falls back gracefully to coarse CPU-side
   *  timing (submitAndGpuWait) when unavailable. */
  hasTimestampQuery: boolean;
}

// ============== WGSL Shader Sources ==============

const COMMON_WGSL = `
struct Params {
  width: u32,
  height: u32,
  radius: u32,
  kernelSize: u32,
};

fn clampIdx(x: i32, y: i32, w: i32, h: i32) -> u32 {
  let cx = clamp(x, 0, w - 1);
  let cy = clamp(y, 0, h - 1);
  return u32(cy * w + cx);
}
`;

const GRADIENT_SHADER = COMMON_WGSL + `
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputBuf: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputBuf: array<vec4<f32>>;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = i32(params.width);
  let h = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  // Sobel operator
  let p00 = inputBuf[clampIdx(x - 1, y - 1, w, h)];
  let p10 = inputBuf[clampIdx(x,     y - 1, w, h)];
  let p20 = inputBuf[clampIdx(x + 1, y - 1, w, h)];
  let p01 = inputBuf[clampIdx(x - 1, y,     w, h)];
  let p21 = inputBuf[clampIdx(x + 1, y,     w, h)];
  let p02 = inputBuf[clampIdx(x - 1, y + 1, w, h)];
  let p12 = inputBuf[clampIdx(x,     y + 1, w, h)];
  let p22 = inputBuf[clampIdx(x + 1, y + 1, w, h)];

  let gx = -p00 + p20 - 2.0 * p01 + 2.0 * p21 - p02 + p22;
  let gy = -p00 - 2.0 * p10 - p20 + p02 + 2.0 * p12 + p22;
  let mag = length(vec2<f32>(gx, gy));

  // R=gx, G=gy, B=magnitude
  outputBuf[u32(y * w + x)] = vec4<f32>(gx, gy, mag, 1.0);
}
`;

const STRUCTURE_TENSOR_SHADER = COMMON_WGSL + `
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> gradBuf: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outputBuf: array<vec4<f32>>;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = i32(params.width);
  let h = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let idx = u32(y * w + x);
  let grad = gradBuf[idx];
  let gx = grad.x;
  let gy = grad.y;

  // Structure tensor: E=gx^2, F=gx*gy, G=gy^2
  let e = gx * gx;
  let f = gx * gy;
  let g = gy * gy;

  // R=E, G=F, B=G, A=magnitude (passed through)
  outputBuf[idx] = vec4<f32>(e, f, g, grad.z);
}
`;

// Both blur directions live in the same module — WGSL allows multiple
// @compute entry points per shader module, so this replaces the WebGL
// version's two separate H/V programs with one module and two pipelines.
const GAUSSIAN_BLUR_SHADER = COMMON_WGSL + `
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputBuf: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outputBuf: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> kernelBuf: array<f32>;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn blurH(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = i32(params.width);
  let h = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let radius = i32(params.radius);
  let kernelSize = i32(params.kernelSize);
  var sum = vec4<f32>(0.0);

  for (var i = 0; i < kernelSize; i = i + 1) {
    let sx = x + (i - radius);
    sum = sum + inputBuf[clampIdx(sx, y, w, h)] * kernelBuf[i];
  }

  outputBuf[u32(y * w + x)] = sum;
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn blurV(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = i32(params.width);
  let h = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let radius = i32(params.radius);
  let kernelSize = i32(params.kernelSize);
  var sum = vec4<f32>(0.0);

  for (var i = 0; i < kernelSize; i = i + 1) {
    let sy = y + (i - radius);
    sum = sum + inputBuf[clampIdx(x, sy, w, h)] * kernelBuf[i];
  }

  outputBuf[u32(y * w + x)] = sum;
}
`;

const TANGENT_EXTRACT_SHADER = COMMON_WGSL + `
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> tensorBuf: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outputBuf: array<vec4<f32>>;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = i32(params.width);
  let h = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let idx = u32(y * w + x);
  let tensor = tensorBuf[idx];
  let e = tensor.x;
  let f = tensor.y;
  let g = tensor.z;
  let mag = tensor.w;

  // Eigenvector for smallest eigenvalue
  let diff = e - g;
  let disc = sqrt(diff * diff + 4.0 * f * f);

  var tangent = vec2<f32>(0.0, 1.0);

  if (abs(f) > 1e-10) {
    let lambda1 = (e + g - disc) * 0.5;
    tangent = vec2<f32>(lambda1 - g, f);
  } else if (e < g) {
    tangent = vec2<f32>(1.0, 0.0);
  } else {
    tangent = vec2<f32>(0.0, 1.0);
  }

  let len = length(tangent);
  if (len > 1e-10) {
    tangent = tangent / len;
  }

  // R=tx, G=ty, B=magnitude (for refinement weighting)
  outputBuf[idx] = vec4<f32>(tangent, mag, 1.0);
}
`;

const TANGENT_REFINE_SHADER = COMMON_WGSL + `
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputBuf: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outputBuf: array<vec4<f32>>;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = i32(params.width);
  let h = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let idx = u32(y * w + x);
  let current = inputBuf[idx];
  let currentT = current.xy;

  var sum = vec2<f32>(0.0);
  var weightSum: f32 = 0.0;

  // 5x5 kernel (radius 2)
  for (var ky = -2; ky <= 2; ky = ky + 1) {
    for (var kx = -2; kx <= 2; kx = kx + 1) {
      let neighbor = inputBuf[clampIdx(x + kx, y + ky, w, h)];
      let neighborT = neighbor.xy;
      let neighborMag = neighbor.z;

      // Direction weight with sign handling
      let dotVal = dot(currentT, neighborT);
      let signVal = select(-1.0, 1.0, dotVal >= 0.0);
      let dirWeight = abs(dotVal);
      let weight = neighborMag * dirWeight;

      sum = sum + signVal * neighborT * weight;
      weightSum = weightSum + weight;
    }
  }

  var refined = currentT;
  if (weightSum > 1e-10) {
    refined = sum / weightSum;
    let len = length(refined);
    if (len > 1e-10) {
      refined = refined / len;
    }
  }

  outputBuf[idx] = vec4<f32>(refined, current.z, 1.0);
}
`;

/**
 * WebGPU-accelerated ETF implementation
 */
export class EdgeTangentFlowWebGPU implements FlowField {
  // Flat, stride-2 (x,y) buffer — avoids allocating pixelCount JS objects.
  private tangents: Float32Array;
  readonly width: number;
  readonly height: number;

  private static resources: WebGPUResources | null = null;
  private static resourcesPromise: Promise<WebGPUResources> | null = null;

  private constructor(tangents: Float32Array, width: number, height: number) {
    this.tangents = tangents;
    this.width = width;
    this.height = height;
  }

  getTangent(x: number, y: number): Vec2 {
    const clampedX = Math.max(0, Math.min(this.width - 1, Math.round(x)));
    const clampedY = Math.max(0, Math.min(this.height - 1, Math.round(y)));
    const idx = (clampedY * this.width + clampedX) * 2;
    return { x: this.tangents[idx], y: this.tangents[idx + 1] };
  }

  getTangentArray(): Float32Array {
    // Already stored in exactly this layout — just hand back a copy so
    // callers can't mutate internal state out from under us.
    return this.tangents.slice();
  }

  /**
   * Cheap synchronous check — mirrors the shape of isWebGLComputeSupported().
   * This only confirms the API surface exists; it can't confirm an adapter
   * is actually obtainable (that requires the async requestAdapter() call
   * made lazily inside initResources/compute).
   */
  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.gpu;
  }

  /**
   * Optional richer diagnostic, matching the BlurStrategyClass shape used
   * elsewhere in this codebase (see types.ts).
   */
  static async getUnsupportedReason(): Promise<string | undefined> {
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      return 'navigator.gpu is unavailable in this environment';
    }
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        return 'No WebGPU adapter could be obtained';
      }
      return undefined;
    } catch (err) {
      return `WebGPU adapter request failed: ${(err as Error).message}`;
    }
  }

  /**
   * Initialize WebGPU device + pipelines (lazy, cached, size-independent).
   */
  private static async initResources(): Promise<WebGPUResources> {
    if (this.resources) {
      console.debug('[EdgeTangentFlowWebGPU] initResources: cache HIT (no GPU work)');
      return this.resources;
    }
    if (this.resourcesPromise) {
      console.debug('[EdgeTangentFlowWebGPU] initResources: awaiting in-flight init');
      return this.resourcesPromise;
    }
    console.debug('[EdgeTangentFlowWebGPU] initResources: cache MISS — cold init starting');

    this.resourcesPromise = (async () => {
      const initTimings: Record<string, number> = {};
      const tInitStart = performance.now();

      if (!navigator.gpu) {
        throw new Error('WebGPU not supported in this environment');
      }

      const tAdapter = performance.now();
      const adapter = await navigator.gpu.requestAdapter();
      initTimings.requestAdapter = performance.now() - tAdapter;
      if (!adapter) {
        throw new Error('Failed to obtain a WebGPU adapter');
      }

      const hasTimestampQuery = adapter.features.has('timestamp-query');
      const tDevice = performance.now();
      const device = await adapter.requestDevice({
        requiredFeatures: hasTimestampQuery ? ['timestamp-query'] : [],
      });
      initTimings.requestDevice = performance.now() - tDevice;

      device.lost.then((info) => {
        // Invalidate the cache so the next compute() call re-initializes.
        if (this.resources && this.resources.device === device) {
          this.resources = null;
          this.resourcesPromise = null;
        }
        console.warn(`WebGPU device lost: ${info.message}`);
      });

      const tPipelines = performance.now();
      const makePipeline = (code: string, entryPoint = 'main'): GPUComputePipeline =>
        device.createComputePipeline({
          layout: 'auto',
          compute: {
            module: device.createShaderModule({ code }),
            entryPoint,
          },
        });

      const blurModule = device.createShaderModule({ code: GAUSSIAN_BLUR_SHADER });
      const blurHPipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module: blurModule, entryPoint: 'blurH' },
      });
      const blurVPipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module: blurModule, entryPoint: 'blurV' },
      });

      const resources: WebGPUResources = {
        device,
        gradientPipeline: makePipeline(GRADIENT_SHADER),
        structureTensorPipeline: makePipeline(STRUCTURE_TENSOR_SHADER),
        blurHPipeline,
        blurVPipeline,
        tangentExtractPipeline: makePipeline(TANGENT_EXTRACT_SHADER),
        tangentRefinePipeline: makePipeline(TANGENT_REFINE_SHADER),
        hasTimestampQuery,
      };
      // NOTE: createComputePipeline() with layout:'auto' returns synchronously,
      // but WGSL compilation/validation may be deferred by the driver until
      // first dispatch — so this number can understate true compile cost.
      // If submitAndGpuWait's first-call time is much higher than later
      // calls, that deferred cost is showing up there, not here.
      initTimings.pipelineCreateSync = performance.now() - tPipelines;

      initTimings.total = performance.now() - tInitStart;
      console.debug('[EdgeTangentFlowWebGPU] cold init timings (ms):', initTimings);

      this.resources = resources;
      return resources;
    })();

    return this.resourcesPromise;
  }

  /**
   * Compute ETF using WebGPU compute shaders.
   *
   * Note this is async (unlike the WebGL version's synchronous compute()),
   * since device acquisition and the final buffer readback (mapAsync) are
   * both inherently asynchronous in WebGPU.
   */
  static async compute(
    input: ChannelImage,
    config: Partial<ETFConfig> = {},
    sigmaC?: number
  ): Promise<EdgeTangentFlowWebGPU> {
    const cfg = { ...DEFAULT_ETF_CONFIG, ...config };
    const { width, height } = input;
    const pixelCount = width * height;

    const timings: Record<string, number> = {};
    const tStart = performance.now();

    const res = await this.initResources();
    const { device } = res;
    timings.resourceInit = performance.now() - tStart;

    // ---- Buffers ----
    const tBuffers = performance.now();
    const inputBuf = createBufferWithData(device, input.data, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    const gradientBuf = createEmptyVec4Buffer(device, pixelCount);
    const tensorBuf = createEmptyVec4Buffer(device, pixelCount);
    const blurTempBuf = createEmptyVec4Buffer(device, pixelCount);
    const blurOutputBuf = createEmptyVec4Buffer(device, pixelCount);
    const tangentBuf1 = createEmptyVec4Buffer(device, pixelCount);
    const tangentBuf2 = createEmptyVec4Buffer(device, pixelCount);

    const smoothSigma = sigmaC ?? cfg.kernelSize / 2.45;
    const radius = Math.min(MAX_BLUR_RADIUS, Math.max(1, Math.ceil(smoothSigma * 2.45)));
    const kernelSize = radius * 2 + 1;
    const kernel = generateGaussianKernel(smoothSigma, kernelSize);
    const kernelBuf = createBufferWithData(device, kernel, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    timings.bufferSetup = performance.now() - tBuffers;

    const dispatchX = Math.ceil(width / WORKGROUP_SIZE);
    const dispatchY = Math.ceil(height / WORKGROUP_SIZE);

    // ---- Optional per-pass GPU timing (requires 'timestamp-query') ----
    // 5 fixed passes (gradient, tensor, blurH, blurV, tangentExtract) plus
    // one per refine iteration. Each pass writes a begin+end timestamp.
    const passLabels: string[] = [];
    const numPasses = 5 + cfg.iterations;
    const querySet = res.hasTimestampQuery
      ? device.createQuerySet({ type: 'timestamp', count: numPasses * 2 })
      : null;
    let passIdx = 0;
    const nextTimestampWrites = (label: string): GPUComputePassTimestampWrites | undefined => {
      if (!querySet) return undefined;
      const writes: GPUComputePassTimestampWrites = {
        querySet,
        beginningOfPassWriteIndex: passIdx * 2,
        endOfPassWriteIndex: passIdx * 2 + 1,
      };
      passLabels.push(label);
      passIdx++;
      return writes;
    };

    const tEncode = performance.now();
    const encoder = device.createCommandEncoder();

    // Step 1: Compute gradients
    {
      const params = createParamsBuffer(device, { width, height, radius: 0, kernelSize: 0 });
      const bindGroup = device.createBindGroup({
        layout: res.gradientPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: inputBuf } },
          { binding: 2, resource: { buffer: gradientBuf } },
        ],
      });
      const pass = encoder.beginComputePass({ timestampWrites: nextTimestampWrites('gradient') });
      pass.setPipeline(res.gradientPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(dispatchX, dispatchY);
      pass.end();
    }

    // Step 2: Build structure tensor
    {
      const params = createParamsBuffer(device, { width, height, radius: 0, kernelSize: 0 });
      const bindGroup = device.createBindGroup({
        layout: res.structureTensorPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: gradientBuf } },
          { binding: 2, resource: { buffer: tensorBuf } },
        ],
      });
      const pass = encoder.beginComputePass({ timestampWrites: nextTimestampWrites('structureTensor') });
      pass.setPipeline(res.structureTensorPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(dispatchX, dispatchY);
      pass.end();
    }

    // Step 3: Gaussian blur the structure tensor (horizontal then vertical)
    {
      const params = createParamsBuffer(device, { width, height, radius, kernelSize });

      const bindGroupH = device.createBindGroup({
        layout: res.blurHPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: tensorBuf } },
          { binding: 2, resource: { buffer: blurTempBuf } },
          { binding: 3, resource: { buffer: kernelBuf } },
        ],
      });
      const passH = encoder.beginComputePass({ timestampWrites: nextTimestampWrites('blurH') });
      passH.setPipeline(res.blurHPipeline);
      passH.setBindGroup(0, bindGroupH);
      passH.dispatchWorkgroups(dispatchX, dispatchY);
      passH.end();

      const bindGroupV = device.createBindGroup({
        layout: res.blurVPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: blurTempBuf } },
          { binding: 2, resource: { buffer: blurOutputBuf } },
          { binding: 3, resource: { buffer: kernelBuf } },
        ],
      });
      const passV = encoder.beginComputePass({ timestampWrites: nextTimestampWrites('blurV') });
      passV.setPipeline(res.blurVPipeline);
      passV.setBindGroup(0, bindGroupV);
      passV.dispatchWorkgroups(dispatchX, dispatchY);
      passV.end();
    }

    // Step 4: Extract initial tangent field
    {
      const params = createParamsBuffer(device, { width, height, radius: 0, kernelSize: 0 });
      const bindGroup = device.createBindGroup({
        layout: res.tangentExtractPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: blurOutputBuf } },
          { binding: 2, resource: { buffer: tangentBuf1 } },
        ],
      });
      const pass = encoder.beginComputePass({ timestampWrites: nextTimestampWrites('tangentExtract') });
      pass.setPipeline(res.tangentExtractPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(dispatchX, dispatchY);
      pass.end();
    }

    // Step 5: Refine tangent field iteratively (ping-pong between buffers)
    let readBuf = tangentBuf1;
    let writeBuf = tangentBuf2;
    const params = createParamsBuffer(device, { width, height, radius: 0, kernelSize: 0 });

    for (let i = 0; i < cfg.iterations; i++) {
      const bindGroup = device.createBindGroup({
        layout: res.tangentRefinePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: readBuf } },
          { binding: 2, resource: { buffer: writeBuf } },
        ],
      });
      const pass = encoder.beginComputePass({ timestampWrites: nextTimestampWrites(`refine[${i}]`) });
      pass.setPipeline(res.tangentRefinePipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(dispatchX, dispatchY);
      pass.end();

      [readBuf, writeBuf] = [writeBuf, readBuf];
    }
    timings.encode = performance.now() - tEncode;

    // ---- Phase A: submit compute passes only, wait for GPU completion ----
    // (No buffer copies here yet — resolveQuerySet writes GPU-side only,
    // it doesn't require a CPU-readable buffer.)
    let queryResolveBuf: GPUBuffer | null = null;
    if (querySet) {
      queryResolveBuf = device.createBuffer({
        size: numPasses * 2 * 8, // one u64 timestamp per write index
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      encoder.resolveQuerySet(querySet, 0, numPasses * 2, queryResolveBuf, 0);
    }

    const tFinishSubmit = performance.now();
    device.queue.submit([encoder.finish()]);
    timings.encoderFinishAndSubmitCall = performance.now() - tFinishSubmit;

    // onSubmittedWorkDone() resolves once the GPU has finished executing
    // everything in this submit — pure compute-pass execution time,
    // including any first-use pipeline compile/link stall the driver
    // deferred from createComputePipeline(). No copy or map involved yet.
    const tComputeWait = performance.now();
    await device.queue.onSubmittedWorkDone();
    timings.computeGpuWait = performance.now() - tComputeWait;

    // ---- Phase B: copy results into mappable buffers, then map+read ----
    const tCopyEncode = performance.now();
    const byteSize = pixelCount * 4 * 4; // vec4<f32>
    const stagingBuf = device.createBuffer({
      size: byteSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    let queryReadBuf: GPUBuffer | null = null;
    const copyEncoder = device.createCommandEncoder();
    copyEncoder.copyBufferToBuffer(readBuf, 0, stagingBuf, 0, byteSize);
    if (querySet && queryResolveBuf) {
      queryReadBuf = device.createBuffer({
        size: queryResolveBuf.size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      copyEncoder.copyBufferToBuffer(queryResolveBuf, 0, queryReadBuf, 0, queryResolveBuf.size);
    }
    device.queue.submit([copyEncoder.finish()]);
    timings.copyEncodeAndSubmit = performance.now() - tCopyEncode;

    const tMapWait = performance.now();
    const mapPromises = [stagingBuf.mapAsync(GPUMapMode.READ)];
    if (queryReadBuf) mapPromises.push(queryReadBuf.mapAsync(GPUMapMode.READ));
    await Promise.all(mapPromises);
    timings.mapAsyncWait = performance.now() - tMapWait;
    // Everything from "done encoding compute passes" to "results mapped":
    timings.submitAndGpuWait =
      timings.encoderFinishAndSubmitCall + timings.computeGpuWait + timings.copyEncodeAndSubmit + timings.mapAsyncWait;

    if (queryReadBuf) {
      const raw = new BigUint64Array(queryReadBuf.getMappedRange().slice(0));
      queryReadBuf.unmap();
      queryReadBuf.destroy();
      queryResolveBuf!.destroy();
      querySet!.destroy();

      const gpuPassTimings: Record<string, number> = {};
      for (let i = 0; i < passLabels.length; i++) {
        const beginNs = raw[i * 2];
        const endNs = raw[i * 2 + 1];
        // Aggregate refine[i] entries under one key so a large `iterations`
        // count doesn't spam the log with per-iteration lines.
        const label = passLabels[i].startsWith('refine[') ? 'refine (sum)' : passLabels[i];
        const ms = Number(endNs - beginNs) / 1e6;
        gpuPassTimings[label] = (gpuPassTimings[label] ?? 0) + ms;
      }
      console.debug('[EdgeTangentFlowWebGPU] per-pass GPU timings (ms):', gpuPassTimings);
    } else if (res.hasTimestampQuery === false) {
      // Only warn once per session-ish; cheap enough to just always note it.
      console.debug(
        '[EdgeTangentFlowWebGPU] timestamp-query unsupported on this device — ' +
          'submitAndGpuWait is a single coarse number, not broken down by pass.'
      );
    }

    const tUnpack = performance.now();
    const mapped = new Float32Array(stagingBuf.getMappedRange().slice(0));
    stagingBuf.unmap();

    // Flat stride-2 copy — no per-pixel object allocation. `mapped` is
    // stride-4 (x,y,mag,1); we only keep (x,y) per pixel.
    const tangents = new Float32Array(pixelCount * 2);
    for (let i = 0; i < pixelCount; i++) {
      tangents[i * 2] = mapped[i * 4];
      tangents[i * 2 + 1] = mapped[i * 4 + 1];
    }
    timings.cpuUnpack = performance.now() - tUnpack;

    // Cleanup temporary (per-call) resources — pipelines/device are cached.
    const tCleanup = performance.now();
    inputBuf.destroy();
    gradientBuf.destroy();
    tensorBuf.destroy();
    blurTempBuf.destroy();
    blurOutputBuf.destroy();
    tangentBuf1.destroy();
    tangentBuf2.destroy();
    kernelBuf.destroy();
    stagingBuf.destroy();
    timings.cleanup = performance.now() - tCleanup;

    timings.total = performance.now() - tStart;
    console.debug('[EdgeTangentFlowWebGPU] timings (ms):', timings);

    return new EdgeTangentFlowWebGPU(tangents, width, height);
  }

  /**
   * Visualize the flow field as a grayscale image
   */
  visualize(): ChannelImage {
    const output = createChannelImage(this.width, this.height);

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = y * this.width + x;
        const tx = this.tangents[idx * 2];
        const ty = this.tangents[idx * 2 + 1];
        const angle = Math.atan2(ty, tx);
        output.data[idx] = (angle + Math.PI) / (2 * Math.PI);
      }
    }

    return output;
  }

  /**
   * Cleanup WebGPU resources (call when done with all ETF computations)
   */
  static dispose(): void {
    const t0 = performance.now();
    if (this.resources) {
      this.resources.device.destroy();
      this.resources = null;
      this.resourcesPromise = null;
      console.debug(
        `[EdgeTangentFlowWebGPU] dispose(): device destroyed in ${(performance.now() - t0).toFixed(2)}ms — ` +
          'cache is now EMPTY; next compute() call will pay full cold-init cost.'
      );
    } else {
      console.debug(`[EdgeTangentFlowWebGPU] dispose(): no-op, resources already empty (${(performance.now() - t0).toFixed(2)}ms)`);
    }
  }
}

// ============== Helper Functions ==============

function alignTo4(bytes: number): number {
  return Math.ceil(bytes / 4) * 4;
}

function createBufferWithData(
  device: GPUDevice,
  data: Float32Array,
  usage: GPUBufferUsageFlags
): GPUBuffer {
  const size = alignTo4(data.byteLength);
  const buffer = device.createBuffer({ size, usage, mappedAtCreation: true });
  new Float32Array(buffer.getMappedRange()).set(data);
  buffer.unmap();
  return buffer;
}

function createEmptyVec4Buffer(device: GPUDevice, pixelCount: number): GPUBuffer {
  return device.createBuffer({
    size: pixelCount * 4 * 4, // vec4<f32>
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
}

function createParamsBuffer(
  device: GPUDevice,
  params: { width: number; height: number; radius: number; kernelSize: number }
): GPUBuffer {
  const buffer = device.createBuffer({
    size: 16, // 4 x u32, already 16-byte aligned
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(
    buffer,
    0,
    new Uint32Array([params.width, params.height, params.radius, params.kernelSize])
  );
  return buffer;
}

function generateGaussianKernel(sigma: number, size: number): Float32Array {
  const kernel = new Float32Array(size);
  const center = Math.floor(size / 2);
  let sum = 0;

  for (let i = 0; i < size; i++) {
    const x = i - center;
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    sum += kernel[i];
  }

  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }

  return kernel;
}

/**
 * Local equivalent of isWebGLComputeSupported() from utils/index.js.
 * Consider hoisting this into utils/index.js as a sibling export.
 */
export function isWebGPUComputeSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}