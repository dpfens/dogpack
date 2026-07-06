/**
 * WebGPU Fast Fourier Transform Implementation
 * Efficient GPU-accelerated FFT using compute shaders
 */
export interface FFTOptions {
    maxSize?: number;
}
export declare class WebGPUFFT {
    private device;
    private queue;
    private pipeline;
    private stagingBuffer;
    private computeBuffer;
    private bindGroup;
    private maxSize;
    private currentSize;
    constructor(options?: FFTOptions);
    /**
     * Initialize the WebGPU device and prepare compute pipeline
     */
    init(): Promise<void>;
    /**
     * Allocate GPU buffers for FFT computation
     */
    private allocateBuffers;
    /**
     * Compute FFT of input data
     * Input: array of alternating real/imaginary values [real0, imag0, real1, imag1, ...]
     * Returns: array of FFT coefficients in same format
     */
    fft(data: Float32Array): Promise<Float32Array>;
    /**
     * Compute inverse FFT
     */
    ifft(data: Float32Array): Promise<Float32Array>;
    /**
     * Get the WGSL compute shader code for FFT
     */
    private getFFTShader;
    /**
     * Clean up GPU resources
     */
    destroy(): void;
}
/**
 * Helper functions for working with complex numbers
 */
export declare const ComplexMath: {
    /**
     * Create a complex number array from real and imaginary components
     */
    fromComponents(real: number[], imag: number[]): Float32Array;
    /**
     * Extract real components from complex array
     */
    getReal(data: Float32Array): Float32Array;
    /**
     * Extract imaginary components from complex array
     */
    getImag(data: Float32Array): Float32Array;
    /**
     * Calculate magnitude spectrum
     */
    getMagnitude(data: Float32Array): Float32Array;
    /**
     * Calculate phase spectrum
     */
    getPhase(data: Float32Array): Float32Array;
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
//# sourceMappingURL=fft.d.ts.map