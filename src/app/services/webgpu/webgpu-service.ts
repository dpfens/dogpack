import { Injectable, signal, computed } from '@angular/core';

/**
 * A single memory heap reported by the adapter (e.g. dedicated VRAM,
 * shared system memory). Mirrors GPUMemoryHeapInfo.
 */
export interface GPUMemoryHeapInfo {
  readonly size: number;
  readonly properties: number;
}

/**
 * The official WebGPU spec only guarantees vendor/architecture/device/
 * description on GPUAdapterInfo. Chrome currently reports quite a bit more
 * (backend, driver, memory heaps, subgroup sizes, etc.) as part of still-
 * stabilizing extensions. We extend the ambient GPUAdapterInfo type with
 * these as optional so consumers get typing/autocomplete without assuming
 * every browser reports them.
 */
export interface ExtendedGPUAdapterInfo extends GPUAdapterInfo {
  /** e.g. "vulkan", "metal", "d3d12" */
  readonly backend?: string;
  /** e.g. "integrated GPU", "discrete GPU", "cpu" */
  readonly type?: string;
  /** Human-readable driver name/version string. */
  readonly driver?: string;
  /** D3D shader model, when the backend is D3D. */
  readonly d3dShaderModel?: number | null;
  /** Raw Vulkan driver version, when the backend is Vulkan. */
  readonly vkDriverVersion?: number;
  /** True if this adapter is a software/fallback adapter rather than real hardware. */
  readonly isFallbackAdapter: boolean;
  /** Power preference the adapter was requested with. */
  readonly powerPreference?: GPUPowerPreference;
  /** Memory heaps (e.g. dedicated VRAM vs. shared system memory). */
  readonly memoryHeaps?: readonly GPUMemoryHeapInfo[];
  readonly subgroupMinSize: number;
  readonly subgroupMaxSize: number;
  readonly subgroupMatrixConfigs?: readonly unknown[];
}

export type WebGpuStatus =
  | 'idle'          // not yet initialized
  | 'checking'      // support check in progress
  | 'unsupported'   // navigator.gpu is not present
  | 'no-adapter'    // gpu present, but no adapter could be obtained
  | 'ready'         // adapter and device acquired
  | 'error';        // something went wrong requesting adapter/device

@Injectable({ providedIn: 'root' })
export class WebGpuService {
  // ---- private writable state ---------------------------------------
  private readonly _status = signal<WebGpuStatus>('idle');
  private readonly _adapter = signal<GPUAdapter | null>(null);
  private readonly _device = signal<GPUDevice | null>(null);
  private readonly _adapterInfo = signal<ExtendedGPUAdapterInfo | null>(null);
  private readonly _features = signal<readonly string[]>([]);
  private readonly _limits = signal<Record<string, number> | null>(null);
  private readonly _error = signal<string | null>(null);

  // ---- public read-only signals --------------------------------------
  readonly status = this._status.asReadonly();
  readonly adapter = this._adapter.asReadonly();
  readonly device = this._device.asReadonly();
  readonly adapterInfo = this._adapterInfo.asReadonly();
  readonly features = this._features.asReadonly();
  readonly limits = this._limits.asReadonly();
  readonly error = this._error.asReadonly();

  /** The device's command queue, once a device exists. */
  readonly queue = computed<GPUQueue | null>(() => this._device()?.queue ?? null);

  /** The `label` the device was created with, if any. */
  readonly deviceLabel = computed(() => this._device()?.label || null);

  /**
   * True as soon as `navigator.gpu` exists — i.e. the browser implements the
   * WebGPU API. This says nothing about whether a real adapter/device can be
   * obtained on this machine; use `isAvailable` for that.
   */
  readonly isSupported = computed(() => typeof navigator !== 'undefined' && !!navigator.gpu);

  /**
   * True once we've actually negotiated a working adapter *and* device.
   * This is the "can I render right now" signal — a browser can be
   * `isSupported` (API exists) while `isAvailable` is false because no
   * compatible GPU/adapter was found, permission was denied, etc.
   */
  readonly isAvailable = computed(() => this._status() === 'ready');

  readonly isChecking = computed(() => this._status() === 'checking');

  /** True once an adapter was obtained, even if device negotiation is still pending/failed. */
  readonly hasAdapter = computed(() => this._adapter() !== null);

  /** Convenience: adapter's preferred canvas format, once a device exists. */
  readonly preferredCanvasFormat = computed<GPUTextureFormat | null>(() => {
    if (!this.isAvailable() || typeof navigator === 'undefined' || !navigator.gpu) {
      return null;
    }
    return navigator.gpu.getPreferredCanvasFormat();
  });

  /** True if the adapter is a software/fallback adapter rather than real hardware. */
  readonly isFallbackAdapter = computed(() => this._adapterInfo()?.isFallbackAdapter ?? false);

  /** Sum of all reported memory heap sizes, in bytes (undefined if not reported). */
  readonly totalMemoryHeapBytes = computed<number | undefined>(() => {
    const heaps = this._adapterInfo()?.memoryHeaps;
    if (!heaps || heaps.length === 0) return undefined;
    return heaps.reduce((sum, heap) => sum + heap.size, 0);
  });

  /**
   * Runs the full support check: presence of the API, adapter request,
   * device request, and population of info/feature/limit signals.
   *
   * Safe to call multiple times (e.g. to re-check after a device loss).
   */
  async initialize(options?: {
    powerPreference?: GPUPowerPreference;
    forceFallbackAdapter?: boolean;
    requiredFeatures?: GPUFeatureName[];
    requiredLimits?: Record<string, number>;
  }): Promise<void> {
    this._status.set('checking');
    this._error.set(null);

    if (!this.isSupported()) {
      this._status.set('unsupported');
      return;
    }

    try {
      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: options?.powerPreference,
        forceFallbackAdapter: options?.forceFallbackAdapter,
      });

      if (!adapter) {
        this._status.set('no-adapter');
        return;
      }

      this._adapter.set(adapter);
      this._adapterInfo.set(await this.readAdapterInfo(adapter));
      this._features.set([...adapter.features].sort());
      this._limits.set(this.readLimits(adapter.limits));

      const device = await adapter.requestDevice({
        requiredFeatures: options?.requiredFeatures,
        requiredLimits: options?.requiredLimits,
      });

      device.lost.then((info) => {
        this._error.set(`GPU device lost: ${info.message || info.reason}`);
        this._device.set(null);
        this._status.set('error');
      });

      this._device.set(device);

      // Prefer the device's own reported features/limits/info once
      // available — they reflect what was actually granted, and
      // `device.adapterInfo` is the more current/live snapshot where
      // supported.
      this._features.set([...device.features].sort());
      this._limits.set(this.readLimits(device.limits));
      this._adapterInfo.set(await this.readAdapterInfo(adapter, device));

      this._status.set('ready');
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : String(err));
      this._status.set('error');
    }
  }

  /** Releases the current device, if any. */
  destroyDevice(): void {
    this._device()?.destroy();
    this._device.set(null);
  }

  // ---- helpers ---------------------------------------------------------

  private async readAdapterInfo(
    adapter: GPUAdapter,
    device?: GPUDevice,
  ): Promise<ExtendedGPUAdapterInfo | null> {
    // Current spec: a synchronous `.info` getter on both GPUAdapter and
    // (more recently) GPUDevice. Older implementations only expose the
    // deprecated, async `adapter.requestAdapterInfo()`.
    let info: ExtendedGPUAdapterInfo | undefined =
      (device as { adapterInfo?: ExtendedGPUAdapterInfo } | undefined)?.adapterInfo ??
      (adapter as { info?: ExtendedGPUAdapterInfo }).info;

    if (!info) {
      const legacyRequest = (
        adapter as unknown as { requestAdapterInfo?: () => Promise<ExtendedGPUAdapterInfo> }
      ).requestAdapterInfo;
      if (typeof legacyRequest === 'function') {
        info = await legacyRequest.call(adapter);
      }
    }

    if (!info) return null;

    return {
      vendor: info.vendor ?? '',
      architecture: info.architecture ?? '',
      device: info.device ?? '',
      description: info.description ?? '',
      backend: info.backend,
      type: info.type,
      driver: info.driver,
      d3dShaderModel: info.d3dShaderModel ?? null,
      vkDriverVersion: info.vkDriverVersion,
      isFallbackAdapter: info.isFallbackAdapter,
      powerPreference: info.powerPreference,
      memoryHeaps: info.memoryHeaps ? [...info.memoryHeaps] : undefined,
      subgroupMinSize: info.subgroupMinSize,
      subgroupMaxSize: info.subgroupMaxSize,
      subgroupMatrixConfigs: info.subgroupMatrixConfigs
        ? [...info.subgroupMatrixConfigs]
        : undefined,
    };
  }

  private readLimits(limits: GPUSupportedLimits): Record<string, number> {
    const result: Record<string, number> = {};
    for (const key in limits) {
      const value = limits[key as keyof GPUSupportedLimits];
      if (typeof value === 'number') {
        result[key] = value;
      }
    }
    return result;
  }
}