export class BaseCPUBlur {
    /**
   * Check if isotropic blur is supported
   * Always returns true as this is a pure JavaScript implementation
   */
  static isSupported(): boolean {
    return true;
  }
  
  /**
   * Get reason if unsupported (always undefined for this implementation)
   */
  static getUnsupportedReason(): string | undefined {
    return undefined;
  }
}


export class BaseWebGLBlur {
  /**
   * Check if WebGL2 is supported in the current environment
   */
  static isSupported(): boolean {
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(1, 1);
        const gl = canvas.getContext('webgl2');
        return gl !== null;
      } else if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2');
        return gl !== null;
      }
      return false;
    } catch {
      return false;
    }
  }
  
  /**
   * Get reason if WebGL2 is not supported
   */
  static getUnsupportedReason(): string | undefined {
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
}


export class BaseWebGPUBlur {
  protected static cachedAdapter: GPUAdapter | null = null;
  protected static cachedDevice: GPUDevice | null = null;
  protected static devicePromise: Promise<GPUDevice | null> | null = null;
  protected static adapterInfo: GPUAdapterInfo | null = null;
  protected static isSoftwareRenderer: boolean = false;

  /**
   * Check if WebGPU is supported (sync check - just API availability)
   */
  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
  }

  /**
   * Get reason if WebGPU is not supported
   */
  static getUnsupportedReason(): string | undefined {
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
    const device = await BaseWebGPUBlur.getWebGPUDevice();
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
}