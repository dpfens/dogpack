import { isWebGLComputeSupported } from "./utils/index.js";

export class BaseCPUStrategy {
  readonly backend = 'cpu' as const;
  dispose(): void {}
  static isSupported(): Promise<boolean> { return Promise.resolve(true); }
  static getUnsupportedReason(): string | undefined { return undefined; }
}

export class BaseWebGLStrategy {
  readonly backend = 'webgl' as const;
  dispose(): void {} // was missing here — Preprocessor/ETFComputer both require Disposable

  static isSupported(): Promise<boolean> {
    return Promise.resolve(isWebGLComputeSupported());
  }

  /**
   * Get reason if WebGL2 is not supported.
   *
   * Declared to allow an async return (per StrategyCtor in interfaces/base.ts)
   * even though this base implementation itself is synchronous, so that
   * subclasses that need to probe the shared/module-level GL context
   * asynchronously can override it without a static-side type conflict.
   */
  static getUnsupportedReason(): string | undefined | Promise<string | undefined> {
    if (typeof OffscreenCanvas === 'undefined' && typeof document === 'undefined') {
        return 'Neither OffscreenCanvas nor document is available';
    }
    try {
        if (typeof OffscreenCanvas !== 'undefined') {
            const canvas = new OffscreenCanvas(1, 1);
            if (!canvas.getContext('webgl2')) {
                return 'WebGL2 context creation failed on OffscreenCanvas';
            }
        } else {
            const canvas = document.createElement('canvas');
            if (!canvas.getContext('webgl2')) {
                return 'WebGL2 context creation failed';
            }
        }
    } catch (e) {
        return `WebGL2 initialization error: ${e}`;
    }
    return undefined;
  }

  /**
   * WebGL errors are synchronous — no scopes, just drain-then-check.
   * See discussion in webgl.ts for why this is needed.
   */
  protected runGuarded<T>(gl: WebGL2RenderingContext, fn: () => T): T {
    while (gl.getError() !== gl.NO_ERROR) {} // drain stale error
    const result = fn();
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      throw new Error(`WebGL error: code ${error}`);
    }
    if (gl.isContextLost()) {
      throw new Error('WebGL context was lost during this operation.');
    }
    return result;
  }
}

export class BaseWebGPUStrategy {
  readonly backend = 'webgpu' as const;
  dispose(): void {} // was missing here too

  protected static cachedAdapter: GPUAdapter | null = null;
  protected static cachedDevice: GPUDevice | null = null;
  protected static devicePromise: Promise<GPUDevice | null> | null = null;
  protected static adapterInfo: GPUAdapterInfo | null = null;
  protected static isSoftwareRenderer: boolean = false;

  /**
   * Check if WebGPU is supported (sync check - just API availability)
   */
  static isSupported(): Promise<boolean> {
    const isSupported = typeof navigator !== 'undefined' && 'gpu' in navigator;
    return Promise.resolve(isSupported);
  }

  /**
   * Get reason if WebGPU is not supported.
   *
   * Declared to allow an async return (per StrategyCtor in interfaces/base.ts)
   * even though this base implementation itself is synchronous, so that
   * subclasses that need to request an adapter to confirm availability
   * can override it without a static-side type conflict.
   */
  static getUnsupportedReason(): string | undefined | Promise<string | undefined> {
    if (typeof navigator === 'undefined') {
      return 'navigator is not available (not in browser environment)';
    }
    if (!('gpu' in navigator)) {
      return 'WebGPU is not supported in this browser';
    }
    return undefined;
  }

  /**
   * Check if the adapter is a software/fallback renderer (call after getWebGPUDevice)
   */
  static isFallbackAdapter(): boolean {
    return this.isSoftwareRenderer;
  }

  /**
   * Get adapter info (call after getWebGPUDevice)
   */
  static getAdapterInfo(): GPUAdapterInfo | null {
    return this.adapterInfo;
  }

  /**
   * Async check if WebGPU is actually usable with hardware acceleration
   * Returns false for software renderers like SwiftShader
   */
  static async isAvailable(allowSoftware = false): Promise<boolean> {
    const device = await BaseWebGPUStrategy.getWebGPUDevice();
    if (!device) return false;
    if (!allowSoftware && this.isSoftwareRenderer) return false;
    return true;
  }

  /**
   * Detect if adapter is a software renderer
   */
  private static detectSoftwareRenderer(adapter: GPUAdapter, info: GPUAdapterInfo): boolean {
    // Most reliable check
    if ((adapter as any).isFallbackAdapter) {
        return true;
    }

    // Check device type
    if ((info as any).type === 'CPU') {
      return true;
    }

    // Check for known software renderer signatures
    const description = (info.description || '').toLowerCase();
    const vendor = (info.vendor || '').toLowerCase();
    const architecture = (info.architecture || '').toLowerCase();

    const softwareIndicators = [
      'swiftshader',
      'llvmpipe',
      'softpipe',
      'microsoft basic render',
      'software',
    ];

    return softwareIndicators.some(
      (indicator) =>
        description.includes(indicator) ||
        vendor.includes(indicator) ||
        architecture.includes(indicator)
    );
  }

  /**
   * Get or create WebGPU device (shared)
   */
  static async getWebGPUDevice(): Promise<GPUDevice | null> {
    if (this.cachedDevice) return this.cachedDevice;

    if (this.devicePromise) return this.devicePromise;

    this.devicePromise = (async () => {
      try {
        if (!navigator.gpu) return null;

        this.cachedAdapter = await navigator.gpu.requestAdapter();
        if (!this.cachedAdapter) return null;

        // Get adapter info and detect software renderer
        this.adapterInfo = await this.cachedAdapter.info;
        this.isSoftwareRenderer = this.detectSoftwareRenderer(
          this.cachedAdapter,
          this.adapterInfo
        );

        this.cachedDevice = await this.cachedAdapter.requestDevice();

        // Handle device loss
        this.cachedDevice.lost.then(() => {
          this.cachedDevice = null;
          this.cachedAdapter = null;
          this.adapterInfo = null;
          this.devicePromise = null;
          this.isSoftwareRenderer = false;
        });

        return this.cachedDevice;
      } catch {
        return null;
      }
    })();

    return this.devicePromise;
  }

  /**
   * WebGPU errors are async (error scopes). See discussion in
   * webgpu.ts for why try/catch alone misses these.
   */
  protected async runGuarded<T>(device: GPUDevice, fn: () => T | Promise<T>): Promise<T> {
    device.pushErrorScope('validation');
    device.pushErrorScope('out-of-memory');

    const cleanup = async () => {
      try {
        const oomError = await device.popErrorScope();
        const validationError = await device.popErrorScope();
        if (validationError) throw new Error(`WebGPU validation error: ${validationError.message}`);
        if (oomError) throw new Error(`WebGPU out-of-memory error: ${oomError.message}`);
      } catch {
        // Device was likely lost mid-scope; popErrorScope can reject in that case.
        // Swallow here — device.lost is the source of truth for that condition.
      }
    };

    try {
      const result = await Promise.race([
        fn(),
        device.lost.then((info) => {
          throw new Error(`WebGPU device lost during operation: ${info.message}`);
        }),
      ]);
      await cleanup();
      return result as T;
    } catch (err) {
      await cleanup();
      throw err;
    }
  }
}