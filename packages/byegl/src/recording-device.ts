/**
 * A transparent GPUDevice proxy used by `enableSync()` to record all WebGPU
 * API calls made during the async device-initialisation window. Once the real
 * GPUDevice is available, `activate()` replays every recorded call in order and
 * switches the proxy into forwarding mode — subsequent calls are passed straight
 * through to the real device (with any recorded-proxy arguments resolved first).
 */

/** Symbol present on every proxy object created by RecordingDevice. */
export const RECORDING_PROXY_ID = Symbol('byegl_recording_proxy_id');

export function isRecordingDevice(device: GPUDevice): boolean {
  return !!(device as any)?.[RECORDING_PROXY_ID];
}

interface RecordedOp {
  targetId: symbol;
  method: string;
  args: unknown[];
  resultId: symbol;
}

/** WebGPU spec-minimum limits, used while the real device is not yet available. */
const FAKE_LIMITS: Record<string, number> = {
  maxTextureDimension1D: 8192,
  maxTextureDimension2D: 8192,
  maxTextureDimension3D: 2048,
  maxTextureArrayLayers: 256,
  maxBindGroups: 4,
  maxBindGroupsPlusVertexBuffers: 24,
  maxBindingsPerBindGroup: 640,
  maxDynamicUniformBuffersPerPipelineLayout: 8,
  maxDynamicStorageBuffersPerPipelineLayout: 4,
  maxSampledTexturesPerShaderStage: 16,
  maxSamplersPerShaderStage: 16,
  maxStorageBuffersPerShaderStage: 8,
  maxStorageTexturesPerShaderStage: 4,
  maxUniformBuffersPerShaderStage: 12,
  maxUniformBufferBindingSize: 65536,
  maxStorageBufferBindingSize: 134217728,
  minUniformBufferOffsetAlignment: 256,
  minStorageBufferOffsetAlignment: 256,
  maxVertexBuffers: 8,
  maxBufferSize: 268435456,
  maxVertexAttributes: 16,
  maxVertexBufferArrayStride: 2048,
  maxInterStageShaderVariables: 16,
  maxColorAttachments: 8,
  maxColorAttachmentBytesPerSample: 32,
  maxComputeWorkgroupStorageSize: 16352,
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupSizeX: 256,
  maxComputeWorkgroupSizeY: 256,
  maxComputeWorkgroupSizeZ: 64,
  maxComputeWorkgroupsPerDimension: 65535,
};

export class RecordingDevice {
  private readonly ops: RecordedOp[] = [];
  /** Maps proxy-id symbol → real GPU object, populated by activate(). */
  readonly realMap = new Map<symbol, unknown>();
  activated = false;

  /** Stable symbol IDs for the device and queue (never re-created). */
  readonly DEVICE_ID = Symbol('device');
  readonly QUEUE_ID = Symbol('queue');

  private readonly _deviceProxy: GPUDevice;
  private readonly _queueProxy: unknown;

  constructor() {
    this._queueProxy = this._makeProxy(this.QUEUE_ID);
    this._deviceProxy = this._makeProxy(this.DEVICE_ID) as GPUDevice;
  }

  get deviceProxy(): GPUDevice {
    return this._deviceProxy;
  }

  // ---------------------------------------------------------------------------
  // Proxy factory
  // ---------------------------------------------------------------------------

  private _makeProxy(id: symbol): unknown {
    const rec = this;
    return new Proxy({ [RECORDING_PROXY_ID]: id } as Record<string | symbol, unknown>, {
      get(target, prop) {
        if (prop === RECORDING_PROXY_ID) return id;
        // Prevent Promise.resolve / async/await from treating this as a thenable
        if (prop === 'then') return undefined;

        if (rec.activated) {
          return rec._forwardGet(id, prop);
        }

        // --- Recording mode ---
        const propStr = String(prop);

        // Known stable sub-objects and read-only device properties
        if (id === rec.DEVICE_ID) {
          if (propStr === 'queue') return rec._queueProxy;
          if (propStr === 'limits') return FAKE_LIMITS;
          if (propStr === 'features') return new Set<GPUFeatureName>();
          if (propStr === 'label') return 'ByeGL Recording Device';
        }
        if (propStr === 'label') return String(id.description);

        // Every other property is assumed to be a method call.
        // Return a function that records the call and returns a child proxy.
        return (...args: unknown[]) => {
          const resultId = Symbol(propStr);
          rec.ops.push({ targetId: id, method: propStr, args, resultId });
          return rec._makeProxy(resultId);
        };
      },
      set: () => true, // Silently accept label / property assignments
    });
  }

  /** Forwarding-mode property access: resolve the real object and wrap the result. */
  private _forwardGet(id: symbol, prop: string | symbol): unknown {
    const real = this.realMap.get(id);
    if (real == null) return undefined;

    const val = (real as Record<string | symbol, unknown>)[prop];
    if (typeof val === 'function') {
      return (...args: unknown[]) => {
        const resolved = args.map((a) => this._resolveDeep(a));
        const result = (val as (...a: unknown[]) => unknown).apply(real, resolved);
        return this._wrapResult(result);
      };
    }
    return this._wrapResult(val);
  }

  /**
   * Wrap a returned value in a forwarding proxy so that any subsequent method
   * calls on it also resolve proxy arguments.  Primitives and buffers are
   * returned as-is.
   */
  private _wrapResult(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object' && typeof value !== 'function') return value;
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;

    const resultId = Symbol('fwd');
    this.realMap.set(resultId, value);
    return this._makeProxy(resultId);
  }

  // ---------------------------------------------------------------------------
  // Deep argument resolution  (proxy → real, descend into plain objects/arrays)
  // ---------------------------------------------------------------------------

  _resolveDeep(value: unknown): unknown {
    if (value === null || value === undefined) return value;

    // Resolve recording proxy → real object
    if (typeof value === 'object' && RECORDING_PROXY_ID in (value as object)) {
      const id = (value as Record<symbol, symbol>)[RECORDING_PROXY_ID];
      return this.realMap.get(id) ?? value;
    }

    if (Array.isArray(value)) {
      return value.map((v) => this._resolveDeep(v));
    }

    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      return value;
    }

    if (typeof value === 'object') {
      // Deep-resolve plain descriptor objects (GPUBufferDescriptor, etc.)
      const resolved: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as object)) {
        resolved[k] = this._resolveDeep(v);
      }
      return resolved;
    }

    return value;
  }

  // ---------------------------------------------------------------------------
  // Activation: replay recorded ops on the real device
  // ---------------------------------------------------------------------------

  activate(realDevice: GPUDevice): void {
    this.realMap.set(this.DEVICE_ID, realDevice);
    this.realMap.set(this.QUEUE_ID, realDevice.queue);

    for (const { targetId, method, args, resultId } of this.ops) {
      const target = this.realMap.get(targetId);
      if (target == null) {
        console.warn(`[ByeGL] RecordingDevice: target for op "${method}" not found during replay`);
        continue;
      }

      const resolved = args.map((a) => this._resolveDeep(a));

      let result: unknown;
      try {
        result = (target as Record<string, (...a: unknown[]) => unknown>)[method](...resolved);
      } catch (e) {
        console.warn(`[ByeGL] RecordingDevice: failed to replay "${method}":`, e);
        continue;
      }

      if (result !== undefined && result !== null) {
        this.realMap.set(resultId, result);
      }
    }

    this.ops.length = 0;
    this.activated = true;
  }
}
