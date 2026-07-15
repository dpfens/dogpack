export declare class BaseCPUStrategy {
    readonly backend: "cpu";
    dispose(): void;
    static isSupported(): Promise<boolean>;
    static getUnsupportedReason(): string | undefined;
}
export declare class BaseWebGLStrategy {
    readonly backend: "webgl";
    dispose(): void;
    static isSupported(): Promise<boolean>;
    /**
     * Get reason if WebGL2 is not supported.
     *
     * Declared to allow an async return (per StrategyCtor in interfaces/base.ts)
     * even though this base implementation itself is synchronous, so that
     * subclasses that need to probe the shared/module-level GL context
     * asynchronously can override it without a static-side type conflict.
     */
    static getUnsupportedReason(): string | undefined | Promise<string | undefined>;
    /**
     * WebGL errors are synchronous — no scopes, just drain-then-check.
     * See discussion in webgl.ts for why this is needed.
     */
    protected runGuarded<T>(gl: WebGL2RenderingContext, fn: () => T): T;
}
export declare class BaseWebGPUStrategy {
    readonly backend: "webgpu";
    dispose(): void;
    protected static cachedAdapter: GPUAdapter | null;
    protected static cachedDevice: GPUDevice | null;
    protected static devicePromise: Promise<GPUDevice | null> | null;
    protected static adapterInfo: GPUAdapterInfo | null;
    protected static isSoftwareRenderer: boolean;
    /**
     * Check if WebGPU is supported (sync check - just API availability)
     */
    static isSupported(): Promise<boolean>;
    /**
     * Get reason if WebGPU is not supported.
     *
     * Declared to allow an async return (per StrategyCtor in interfaces/base.ts)
     * even though this base implementation itself is synchronous, so that
     * subclasses that need to request an adapter to confirm availability
     * can override it without a static-side type conflict.
     */
    static getUnsupportedReason(): string | undefined | Promise<string | undefined>;
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
    /**
     * WebGPU errors are async (error scopes). See discussion in
     * webgpu.ts for why try/catch alone misses these.
     */
    protected runGuarded<T>(device: GPUDevice, fn: () => T | Promise<T>): Promise<T>;
}
//# sourceMappingURL=base.d.ts.map