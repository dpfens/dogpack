export declare class BaseCPUBlur {
    /**
   * Check if isotropic blur is supported
   * Always returns true as this is a pure JavaScript implementation
   */
    static isSupported(): boolean;
    /**
     * Get reason if unsupported (always undefined for this implementation)
     */
    static getUnsupportedReason(): string | undefined;
}
export declare class BaseWebGLBlur {
    /**
     * Check if WebGL2 is supported in the current environment
     */
    static isSupported(): boolean;
    /**
     * Get reason if WebGL2 is not supported
     */
    static getUnsupportedReason(): string | undefined;
}
export declare class BaseWebGPUBlur {
    protected static cachedAdapter: GPUAdapter | null;
    protected static cachedDevice: GPUDevice | null;
    protected static devicePromise: Promise<GPUDevice | null> | null;
    protected static adapterInfo: GPUAdapterInfo | null;
    protected static isSoftwareRenderer: boolean;
    /**
     * Check if WebGPU is supported (sync check - just API availability)
     */
    static isSupported(): boolean;
    /**
     * Get reason if WebGPU is not supported
     */
    static getUnsupportedReason(): string | undefined;
    /**
     * Check if the adapter is a software/fallback renderer (call after getWebGPUDevice)
     */
    static isFallbackAdapter(): boolean;
    /**
     * Get adapter info (call after getWebGPUDevice)
     */
    static getAdapterInfo(): GPUAdapterInfo | null;
    /**
     * Async check if WebGPU is actually usable with hardware acceleration
     * Returns false for software renderers like SwiftShader
     */
    static isAvailable(allowSoftware?: boolean): Promise<boolean>;
    /**
     * Detect if adapter is a software renderer
     */
    private static detectSoftwareRenderer;
    /**
     * Get or create WebGPU device (shared)
     */
    static getWebGPUDevice(): Promise<GPUDevice | null>;
}
//# sourceMappingURL=base.d.ts.map