/**
 * WebGPU-accelerated blur strategies
 */
/**
 * WebGPU compute shader for horizontal Gaussian blur
 */
const HORIZONTAL_BLUR_WGSL = `
  struct Params {
    width: u32,
    height: u32,
    kernelSize: u32,
    _padding: u32,
  }
  
  @group(0) @binding(0) var<uniform> params: Params;
  @group(0) @binding(1) var<storage, read> kernel: array<f32>;
  @group(0) @binding(2) var<storage, read> input: array<f32>;
  @group(0) @binding(3) var<storage, read_write> output: array<f32>;
  
  @compute @workgroup_size(16, 16)
  fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
      return;
    }
    
    let halfKernel = i32(params.kernelSize) / 2;
    var sum: f32 = 0.0;
    
    for (var k: i32 = 0; k < i32(params.kernelSize); k++) {
      let sampleX = clamp(i32(x) + k - halfKernel, 0, i32(params.width) - 1);
      let idx = u32(sampleX) + y * params.width;
      sum += input[idx] * kernel[k];
    }
    
    output[x + y * params.width] = sum;
  }
`;
/**
 * WebGPU compute shader for vertical Gaussian blur
 */
const VERTICAL_BLUR_WGSL = `
  struct Params {
    width: u32,
    height: u32,
    kernelSize: u32,
    _padding: u32,
  }
  
  @group(0) @binding(0) var<uniform> params: Params;
  @group(0) @binding(1) var<storage, read> kernel: array<f32>;
  @group(0) @binding(2) var<storage, read> input: array<f32>;
  @group(0) @binding(3) var<storage, read_write> output: array<f32>;
  
  @compute @workgroup_size(16, 16)
  fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
      return;
    }
    
    let halfKernel = i32(params.kernelSize) / 2;
    var sum: f32 = 0.0;
    
    for (var k: i32 = 0; k < i32(params.kernelSize); k++) {
      let sampleY = clamp(i32(y) + k - halfKernel, 0, i32(params.height) - 1);
      let idx = x + u32(sampleY) * params.width;
      sum += input[idx] * kernel[k];
    }
    
    output[x + y * params.width] = sum;
  }
`;
/**
 * WebGPU compute shader for flow-guided blur
 */
const FLOW_BLUR_WGSL = `
  struct Params {
    width: u32,
    height: u32,
    kernelSize: u32,
    _padding: u32,
  }
  
  @group(0) @binding(0) var<uniform> params: Params;
  @group(0) @binding(1) var<storage, read> kernel: array<f32>;
  @group(0) @binding(2) var<storage, read> input: array<f32>;
  @group(0) @binding(3) var<storage, read> flowField: array<vec2<f32>>;
  @group(0) @binding(4) var<storage, read_write> output: array<f32>;
  
  fn sampleBilinear(x: f32, y: f32) -> f32 {
    let x0 = u32(floor(x));
    let y0 = u32(floor(y));
    let x1 = min(x0 + 1u, params.width - 1u);
    let y1 = min(y0 + 1u, params.height - 1u);
    
    let fx = x - floor(x);
    let fy = y - floor(y);
    
    let v00 = input[x0 + y0 * params.width];
    let v10 = input[x1 + y0 * params.width];
    let v01 = input[x0 + y1 * params.width];
    let v11 = input[x1 + y1 * params.width];
    
    return v00 * (1.0 - fx) * (1.0 - fy) +
           v10 * fx * (1.0 - fy) +
           v01 * (1.0 - fx) * fy +
           v11 * fx * fy;
  }
  
  fn getFlow(x: f32, y: f32) -> vec2<f32> {
    let cx = clamp(u32(round(x)), 0u, params.width - 1u);
    let cy = clamp(u32(round(y)), 0u, params.height - 1u);
    return flowField[cx + cy * params.width];
  }
  
  @compute @workgroup_size(16, 16)
  fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= params.width || y >= params.height) {
      return;
    }
    
    let halfKernel = i32(params.kernelSize) / 2;
    var sum: f32 = 0.0;
    var weightSum: f32 = 0.0;
    
    // Sample in positive flow direction
    var px: f32 = f32(x);
    var py: f32 = f32(y);
    for (var i: i32 = halfKernel; i < i32(params.kernelSize); i++) {
      sum += sampleBilinear(px, py) * kernel[i];
      weightSum += kernel[i];
      
      let tangent = getFlow(px, py);
      px += tangent.x;
      py += tangent.y;
    }
    
    // Sample in negative flow direction
    px = f32(x);
    py = f32(y);
    for (var i: i32 = halfKernel - 1; i >= 0; i--) {
      let tangent = getFlow(px, py);
      px -= tangent.x;
      py -= tangent.y;
      
      sum += sampleBilinear(px, py) * kernel[i];
      weightSum += kernel[i];
    }
    
    if (weightSum > 0.0) {
      output[x + y * params.width] = sum / weightSum;
    } else {
      output[x + y * params.width] = 0.0;
    }
  }
`;
/**
 * Generate 1D Gaussian kernel
 */
function generateGaussianKernel(sigma, size) {
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
const DEFAULT_WEBGPU_CONFIG = {
    kernelSizeMultiplier: 6,
    maxKernelSize: 127,
};
// Cache for WebGPU adapter/device (shared across instances)
let cachedAdapter = null;
let cachedDevice = null;
let devicePromise = null;
/**
 * Get or create WebGPU device (shared)
 */
async function getWebGPUDevice() {
    if (cachedDevice)
        return cachedDevice;
    if (devicePromise)
        return devicePromise;
    devicePromise = (async () => {
        try {
            if (!navigator.gpu)
                return null;
            cachedAdapter = await navigator.gpu.requestAdapter();
            if (!cachedAdapter)
                return null;
            cachedDevice = await cachedAdapter.requestDevice();
            // Handle device loss
            cachedDevice.lost.then(() => {
                cachedDevice = null;
                cachedAdapter = null;
                devicePromise = null;
            });
            return cachedDevice;
        }
        catch {
            return null;
        }
    })();
    return devicePromise;
}
/**
 * WebGPU-accelerated isotropic Gaussian blur
 * Uses compute shaders with separable convolution
 */
export class WebGPUIsotropicBlur {
    config;
    resources = null;
    initPromise = null;
    // Reusable buffers
    paramsBuffer = null;
    kernelBuffer = null;
    inputBuffer = null;
    tempBuffer = null;
    outputBuffer = null;
    stagingBuffer = null;
    currentBufferSize = 0;
    currentKernelSize = 0;
    /**
     * Check if WebGPU is supported
     */
    static isSupported() {
        return typeof navigator !== 'undefined' && 'gpu' in navigator;
    }
    /**
     * Get reason if WebGPU is not supported
     */
    static getUnsupportedReason() {
        if (typeof navigator === 'undefined') {
            return 'navigator is not available (not in browser environment)';
        }
        if (!('gpu' in navigator)) {
            return 'WebGPU is not supported in this browser';
        }
        return undefined;
    }
    /**
     * Async check if WebGPU is actually usable (adapter + device available)
     */
    static async isAvailable() {
        const device = await getWebGPUDevice();
        return device !== null;
    }
    constructor(config = {}) {
        this.config = { ...DEFAULT_WEBGPU_CONFIG, ...config };
    }
    /**
     * Initialize WebGPU resources
     */
    async initResources() {
        if (this.resources)
            return this.resources;
        const device = await getWebGPUDevice();
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
    ensureBuffers(device, pixelCount, kernelSize) {
        const bufferSize = pixelCount * 4; // Float32
        if (this.currentBufferSize < bufferSize) {
            // Clean up old buffers
            this.inputBuffer?.destroy();
            this.tempBuffer?.destroy();
            this.outputBuffer?.destroy();
            this.stagingBuffer?.destroy();
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
            this.stagingBuffer = device.createBuffer({
                size: bufferSize,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
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
     * Blur implementation - must be called with await
     */
    async blur(input, sigma) {
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
        const kernelSize = Math.min(this.config.maxKernelSize, Math.max(3, Math.floor(sigma * this.config.kernelSizeMultiplier) | 1));
        const kernel = generateGaussianKernel(sigma, kernelSize);
        // Ensure buffers
        this.ensureBuffers(device, pixelCount, kernelSize);
        // Upload data (ensure we're using ArrayBuffer, not SharedArrayBuffer)
        device.queue.writeBuffer(this.paramsBuffer, 0, new Uint32Array([width, height, kernelSize, 0]));
        device.queue.writeBuffer(this.kernelBuffer, 0, new Float32Array(kernel));
        device.queue.writeBuffer(this.inputBuffer, 0, new Float32Array(input.data));
        // Create bind groups
        const horizontalBindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.paramsBuffer } },
                { binding: 1, resource: { buffer: this.kernelBuffer } },
                { binding: 2, resource: { buffer: this.inputBuffer } },
                { binding: 3, resource: { buffer: this.tempBuffer } },
            ],
        });
        const verticalBindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.paramsBuffer } },
                { binding: 1, resource: { buffer: this.kernelBuffer } },
                { binding: 2, resource: { buffer: this.tempBuffer } },
                { binding: 3, resource: { buffer: this.outputBuffer } },
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
        // Copy to staging buffer
        commandEncoder.copyBufferToBuffer(this.outputBuffer, 0, this.stagingBuffer, 0, pixelCount * 4);
        device.queue.submit([commandEncoder.finish()]);
        // Read back result
        await this.stagingBuffer.mapAsync(GPUMapMode.READ);
        const resultData = new Float32Array(this.stagingBuffer.getMappedRange().slice(0));
        this.stagingBuffer.unmap();
        return {
            data: resultData,
            width,
            height,
        };
    }
    /**
     * Clean up GPU resources
     */
    dispose() {
        this.paramsBuffer?.destroy();
        this.kernelBuffer?.destroy();
        this.inputBuffer?.destroy();
        this.tempBuffer?.destroy();
        this.outputBuffer?.destroy();
        this.stagingBuffer?.destroy();
        this.paramsBuffer = null;
        this.kernelBuffer = null;
        this.inputBuffer = null;
        this.tempBuffer = null;
        this.outputBuffer = null;
        this.stagingBuffer = null;
        this.currentBufferSize = 0;
        this.currentKernelSize = 0;
        // Note: We don't destroy the device as it's shared
        this.resources = null;
    }
}
/**
 * WebGPU-accelerated flow-guided blur
 */
export class WebGPUFlowGuidedBlur {
    config;
    flowField;
    resources = null;
    // Buffers
    paramsBuffer = null;
    kernelBuffer = null;
    inputBuffer = null;
    flowBuffer = null;
    outputBuffer = null;
    stagingBuffer = null;
    currentBufferSize = 0;
    currentKernelSize = 0;
    static isSupported() {
        return WebGPUIsotropicBlur.isSupported();
    }
    static getUnsupportedReason() {
        return WebGPUIsotropicBlur.getUnsupportedReason();
    }
    static async isAvailable() {
        return WebGPUIsotropicBlur.isAvailable();
    }
    constructor(flowField, config = {}) {
        this.flowField = flowField;
        this.config = { ...DEFAULT_WEBGPU_CONFIG, ...config };
    }
    async initResources() {
        if (this.resources)
            return this.resources;
        const device = await getWebGPUDevice();
        if (!device) {
            throw new Error('WebGPU device not available');
        }
        // Flow blur needs 5 bindings
        const flowBindGroupLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        const pipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [flowBindGroupLayout],
        });
        const flowPipeline = device.createComputePipeline({
            layout: pipelineLayout,
            compute: {
                module: device.createShaderModule({ code: FLOW_BLUR_WGSL }),
                entryPoint: 'main',
            },
        });
        this.resources = {
            device,
            horizontalPipeline: null, // Not used for flow blur
            verticalPipeline: null,
            bindGroupLayout: flowBindGroupLayout,
            flowPipeline,
            flowBindGroupLayout,
        };
        return this.resources;
    }
    ensureBuffers(device, width, height, kernelSize) {
        const pixelCount = width * height;
        const bufferSize = pixelCount * 4;
        const flowBufferSize = pixelCount * 8; // vec2<f32> per pixel
        if (this.currentBufferSize < bufferSize) {
            this.inputBuffer?.destroy();
            this.flowBuffer?.destroy();
            this.outputBuffer?.destroy();
            this.stagingBuffer?.destroy();
            this.inputBuffer = device.createBuffer({
                size: bufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            this.flowBuffer = device.createBuffer({
                size: flowBufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            this.outputBuffer = device.createBuffer({
                size: bufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
            });
            this.stagingBuffer = device.createBuffer({
                size: bufferSize,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            });
            this.currentBufferSize = bufferSize;
            // Upload flow field
            const flowData = new Float32Array(pixelCount * 2);
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 2;
                    const tangent = this.flowField.getTangent(x, y);
                    flowData[idx] = tangent.x;
                    flowData[idx + 1] = tangent.y;
                }
            }
            device.queue.writeBuffer(this.flowBuffer, 0, flowData);
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
                size: 16,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
        }
    }
    async blur(input, sigma) {
        if (sigma < 0.1) {
            return {
                data: new Float32Array(input.data),
                width: input.width,
                height: input.height,
            };
        }
        const { device, flowPipeline, flowBindGroupLayout } = await this.initResources();
        const { width, height } = input;
        const pixelCount = width * height;
        const kernelSize = Math.min(this.config.maxKernelSize, Math.max(3, Math.floor(sigma * this.config.kernelSizeMultiplier) | 1));
        const kernel = generateGaussianKernel(sigma, kernelSize);
        this.ensureBuffers(device, width, height, kernelSize);
        device.queue.writeBuffer(this.paramsBuffer, 0, new Uint32Array([width, height, kernelSize, 0]));
        device.queue.writeBuffer(this.kernelBuffer, 0, new Float32Array(kernel));
        device.queue.writeBuffer(this.inputBuffer, 0, new Float32Array(input.data));
        const bindGroup = device.createBindGroup({
            layout: flowBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.paramsBuffer } },
                { binding: 1, resource: { buffer: this.kernelBuffer } },
                { binding: 2, resource: { buffer: this.inputBuffer } },
                { binding: 3, resource: { buffer: this.flowBuffer } },
                { binding: 4, resource: { buffer: this.outputBuffer } },
            ],
        });
        const workgroupsX = Math.ceil(width / 16);
        const workgroupsY = Math.ceil(height / 16);
        const commandEncoder = device.createCommandEncoder();
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(flowPipeline);
        computePass.setBindGroup(0, bindGroup);
        computePass.dispatchWorkgroups(workgroupsX, workgroupsY);
        computePass.end();
        commandEncoder.copyBufferToBuffer(this.outputBuffer, 0, this.stagingBuffer, 0, pixelCount * 4);
        device.queue.submit([commandEncoder.finish()]);
        await this.stagingBuffer.mapAsync(GPUMapMode.READ);
        const resultData = new Float32Array(this.stagingBuffer.getMappedRange().slice(0));
        this.stagingBuffer.unmap();
        return {
            data: resultData,
            width,
            height,
        };
    }
    dispose() {
        this.paramsBuffer?.destroy();
        this.kernelBuffer?.destroy();
        this.inputBuffer?.destroy();
        this.flowBuffer?.destroy();
        this.outputBuffer?.destroy();
        this.stagingBuffer?.destroy();
        this.paramsBuffer = null;
        this.kernelBuffer = null;
        this.inputBuffer = null;
        this.flowBuffer = null;
        this.outputBuffer = null;
        this.stagingBuffer = null;
        this.currentBufferSize = 0;
        this.currentKernelSize = 0;
        this.resources = null;
    }
}
//# sourceMappingURL=blur-webgpu.js.map