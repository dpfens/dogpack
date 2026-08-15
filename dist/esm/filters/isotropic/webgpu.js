import { BaseWebGPUStrategy } from "../../base.js";
import { DEFAULT_ISOTROPIC_BLUR_CONFIG } from "../../interfaces/base.js";
import { isWebGPUSupported } from "../../utils/device.js";
import { generateGaussianKernel } from '../../utils/math.js';
import WEBGPU_HORIZONTAL_BLUE_SOURCE from './shaders/webgpu-horizontal-blur.wgsl.js';
import WEBGPU_VERTICAL_BLUE_SOURCE from './shaders/webgpu-vertical-blur.wgsl.js';
/**
 * WebGPU-accelerated isotropic Gaussian blur
 * Uses compute shaders with separable convolution
 *
 * Supports concurrent/parallel blur calls by creating
 * separate staging buffers for each operation instead of reusing one.
 */
export class WebGPUIsotropicFilter extends BaseWebGPUStrategy {
    resources = null;
    /**
     * Confirms an adapter is actually obtainable, not just that
     * `navigator.gpu` exists as an API surface.
     */
    static async isSupported() {
        return isWebGPUSupported();
    }
    /**
     * Initialize WebGPU resources
     */
    async initResources() {
        if (this.resources)
            return this.resources;
        const device = await WebGPUIsotropicFilter.getWebGPUDevice();
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
    async apply(input, config) {
        const cfg = { ...DEFAULT_ISOTROPIC_BLUR_CONFIG, ...config };
        const { sigma } = cfg;
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
        const kernelSize = Math.min(cfg.maxKernelSize, Math.max(3, Math.floor(sigma * cfg.kernelSizeMultiplier) | 1));
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
        }
        finally {
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
    dispose() { }
}
//# sourceMappingURL=webgpu.js.map