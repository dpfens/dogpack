/**
 * WebGPU Fast Fourier Transform Implementation
 * Efficient GPU-accelerated FFT using compute shaders
 */
export class WebGPUFFT {
    device = null;
    queue = null;
    pipeline = null;
    stagingBuffer = null;
    computeBuffer = null;
    bindGroup = null;
    maxSize;
    currentSize = 0;
    constructor(options = {}) {
        this.maxSize = options.maxSize || 65536;
    }
    /**
     * Initialize the WebGPU device and prepare compute pipeline
     */
    async init() {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter)
            throw new Error("WebGPU adapter not found");
        this.device = await adapter.requestDevice();
        this.queue = this.device.queue;
        // Create compute shader for FFT
        const shaderCode = this.getFFTShader();
        const shaderModule = this.device.createShaderModule({ code: shaderCode });
        this.pipeline = this.device.createComputePipeline({
            layout: "auto",
            compute: { module: shaderModule, entryPoint: "fft_compute" },
        });
        // Pre-allocate buffers
        this.allocateBuffers(this.maxSize);
    }
    /**
     * Allocate GPU buffers for FFT computation
     */
    allocateBuffers(size) {
        if (!this.device)
            throw new Error("Device not initialized");
        // Main compute buffer (for complex numbers as pairs of f32)
        this.computeBuffer = this.device.createBuffer({
            size: size * 8, // 2 f32 per complex number
            usage: GPUBufferUsage.STORAGE |
                GPUBufferUsage.COPY_SRC |
                GPUBufferUsage.COPY_DST,
            mappedAtCreation: false,
        });
        // Staging buffer for CPU read-back
        this.stagingBuffer = this.device.createBuffer({
            size: size * 8,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            mappedAtCreation: false,
        });
        // Create bind group for shader
        if (this.pipeline) {
            this.bindGroup = this.device.createBindGroup({
                layout: this.pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.computeBuffer } },
                    { binding: 1, resource: { buffer: this.computeBuffer } },
                ],
            });
        }
        this.currentSize = size;
    }
    /**
     * Compute FFT of input data
     * Input: array of alternating real/imaginary values [real0, imag0, real1, imag1, ...]
     * Returns: array of FFT coefficients in same format
     */
    async fft(data) {
        if (!this.device || !this.queue || !this.pipeline || !this.bindGroup) {
            throw new Error("FFT not initialized. Call init() first.");
        }
        const n = data.length / 2; // Number of complex values
        if (n & (n - 1)) {
            throw new Error("Input size must be a power of 2");
        }
        // Re-allocate if needed
        if (n * 2 > this.currentSize) {
            this.allocateBuffers(Math.pow(2, Math.ceil(Math.log2(n * 2))));
        }
        // Write data to GPU
        this.queue.writeBuffer(this.computeBuffer, 0, data);
        // Create command encoder
        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, this.bindGroup);
        // Calculate workgroup size
        const workgroupSize = 256;
        const workgroups = Math.ceil(n / workgroupSize);
        passEncoder.dispatchWorkgroups(workgroups);
        passEncoder.end();
        // Copy result to staging buffer
        commandEncoder.copyBufferToBuffer(this.computeBuffer, 0, this.stagingBuffer, 0, n * 8);
        this.queue.submit([commandEncoder.finish()]);
        // Read result back
        await this.stagingBuffer.mapAsync(GPUMapMode.READ);
        const result = new Float32Array(this.stagingBuffer.getMappedRange().slice(0, n * 8));
        this.stagingBuffer.unmap();
        return result;
    }
    /**
     * Compute inverse FFT
     */
    async ifft(data) {
        if (!this.device || !this.queue || !this.pipeline || !this.bindGroup) {
            throw new Error("FFT not initialized. Call init() first.");
        }
        const n = data.length / 2;
        // Conjugate input
        const conjugated = new Float32Array(data);
        for (let i = 1; i < conjugated.length; i += 2) {
            conjugated[i] = -conjugated[i];
        }
        // Forward FFT
        const result = await this.fft(conjugated);
        // Conjugate and scale output
        for (let i = 1; i < result.length; i += 2) {
            result[i] = -result[i];
        }
        for (let i = 0; i < result.length; i++) {
            result[i] /= n;
        }
        return result;
    }
    /**
     * Get the WGSL compute shader code for FFT
     */
    getFFTShader() {
        return `
      struct Complex {
        r: f32,
        i: f32,
      }

      @group(0) @binding(0) var<storage, read_write> data: array<Complex>;
      @group(0) @binding(1) var<storage, read_write> scratch: array<Complex>;

      fn complex_mul(a: Complex, b: Complex) -> Complex {
        return Complex(
          a.r * b.r - a.i * b.i,
          a.r * b.i + a.i * b.r
        );
      }

      fn complex_add(a: Complex, b: Complex) -> Complex {
        return Complex(a.r + b.r, a.i + b.i);
      }

      fn complex_sub(a: Complex, b: Complex) -> Complex {
        return Complex(a.r - b.r, a.i - b.i);
      }

      @compute @workgroup_size(256)
      fn fft_compute(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let idx = global_id.x;
        let n = 1024u; // Must match input size; adjust as needed for dynamic operation

        // Bit-reversal permutation
        var bit_reversed = 0u;
        var x = idx;
        var n_bits = 10u; // log2(1024)
        for (var i = 0u; i < n_bits; i = i + 1u) {
          bit_reversed = (bit_reversed << 1u) | (x & 1u);
          x = x >> 1u;
        }
        workgroupBarrier();

        // Perform FFT stages
        for (var stage = 1u; stage <= n_bits; stage = stage + 1u) {
          let size = 1u << stage;
          let half = size >> 1u;
          let angle = -6.283185307179586 / f32(size);

          let group = (idx / half) * size;
          let pos = idx % half;

          if (group + pos + half < n) {
            let idx1 = group + pos;
            let idx2 = idx1 + half;

            let a = data[idx1];
            let b = data[idx2];

            let w_angle = angle * f32(pos);
            let w = Complex(cos(w_angle), sin(w_angle));
            let b_w = complex_mul(b, w);

            data[idx1] = complex_add(a, b_w);
            data[idx2] = complex_sub(a, b_w);
          }

          workgroupBarrier();
        }
      }
    `;
    }
    /**
     * Clean up GPU resources
     */
    destroy() {
        this.computeBuffer?.destroy();
        this.stagingBuffer?.destroy();
    }
}
/**
 * Helper functions for working with complex numbers
 */
export const ComplexMath = {
    /**
     * Create a complex number array from real and imaginary components
     */
    fromComponents(real, imag) {
        const result = new Float32Array(real.length * 2);
        for (let i = 0; i < real.length; i++) {
            result[i * 2] = real[i];
            result[i * 2 + 1] = imag[i];
        }
        return result;
    },
    /**
     * Extract real components from complex array
     */
    getReal(data) {
        const result = new Float32Array(data.length / 2);
        for (let i = 0; i < result.length; i++) {
            result[i] = data[i * 2];
        }
        return result;
    },
    /**
     * Extract imaginary components from complex array
     */
    getImag(data) {
        const result = new Float32Array(data.length / 2);
        for (let i = 0; i < result.length; i++) {
            result[i] = data[i * 2 + 1];
        }
        return result;
    },
    /**
     * Calculate magnitude spectrum
     */
    getMagnitude(data) {
        const result = new Float32Array(data.length / 2);
        for (let i = 0; i < result.length; i++) {
            const r = data[i * 2];
            const im = data[i * 2 + 1];
            result[i] = Math.sqrt(r * r + im * im);
        }
        return result;
    },
    /**
     * Calculate phase spectrum
     */
    getPhase(data) {
        const result = new Float32Array(data.length / 2);
        for (let i = 0; i < result.length; i++) {
            const r = data[i * 2];
            const im = data[i * 2 + 1];
            result[i] = Math.atan2(im, r);
        }
        return result;
    },
};
/**
 * Usage example (not part of export):
 *
 * const fft = new WebGPUFFT({ maxSize: 8192 });
 * await fft.init();
 *
 * const real = new Float32Array(1024);
 * const imag = new Float32Array(1024);
 * real[0] = 1; // Initialize with some data
 *
 * const input = ComplexMath.fromComponents(
 *   Array.from(real),
 *   Array.from(imag)
 * );
 *
 * const result = await fft.fft(input);
 * const magnitude = ComplexMath.getMagnitude(result);
 *
 * fft.destroy();
 */ 
//# sourceMappingURL=fft.js.map