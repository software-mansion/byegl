/**
 * A transparent GPUDevice proxy used by `enableSync()` to record all WebGPU
 * API calls made during the async device-initialisation window. Once the real
 * GPUDevice is available, `activate()` replays every recorded call in order and
 * switches the proxy into forwarding mode — subsequent calls are passed straight
 * through to the real device (with any recorded-proxy arguments resolved first).
 */

/** Symbol present on every proxy object created by RecordingDevice. */
const RECORDING_PROXY = Symbol('byegl_recording_proxy');

/** Symbol present on every proxy object created by RecordingDevice. */
const REAL_VALUE = Symbol('byegl_real_value');

export function isRecordingProxy(value: unknown): boolean {
  return !!(value as any)?.[RECORDING_PROXY];
}

function unwrapProxy<T>(proxyOrValue: T): T {
  if (isRecordingProxy(proxyOrValue)) {
    return ((proxyOrValue as any)?.[REAL_VALUE]);
  }
  return proxyOrValue;
}

function unwrapProxiesDeep<T>(proxyOrValue: T): T {
  if (isRecordingProxy(proxyOrValue)) {
    return ((proxyOrValue as any)?.[REAL_VALUE]);
  }

  if (Array.isArray(proxyOrValue)) {
    return proxyOrValue.map(unwrapProxiesDeep) as unknown as T;
  }

  if (typeof proxyOrValue === 'object' && Object.getPrototypeOf(proxyOrValue) === Object.prototype) {
    const swapped = { ...proxyOrValue };
    let swappedSome = false;
    for (const key in swapped) {
      const value = unwrapProxiesDeep(swapped[key])
      if (swapped[key] !== value) {
        swapped[key] = value;
        swappedSome = true;
      }
    }
    return swappedSome ? swapped : proxyOrValue;
  }

  return proxyOrValue;
}

type RecordedOp = () => void;

/** WebGPU spec-minimum limits, used while the real device is not yet available. */
const FAKE_LIMITS: Record<string, number> = {
  maxBindGroups: 4,
  maxBindGroupsPlusVertexBuffers: 24,
  maxBindingsPerBindGroup: 1000,
  maxBufferSize: 268435456,
  maxColorAttachmentBytesPerSample: 32,
  maxColorAttachments: 8,
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupSizeX: 256,
  maxComputeWorkgroupSizeY: 256,
  maxComputeWorkgroupSizeZ: 64,
  maxComputeWorkgroupStorageSize: 16384,
  maxComputeWorkgroupsPerDimension: 65535,
  maxDynamicStorageBuffersPerPipelineLayout: 4,
  maxDynamicUniformBuffersPerPipelineLayout: 8,
  maxInterStageShaderVariables: 16,
  maxSampledTexturesPerShaderStage: 16,
  maxSamplersPerShaderStage: 16,
  maxStorageBufferBindingSize: 134217728,
  maxStorageBuffersPerShaderStage: 8,
  maxStorageTexturesPerShaderStage: 4,
  maxTextureArrayLayers: 256,
  maxTextureDimension1D: 8192,
  maxTextureDimension2D: 8192,
  maxTextureDimension3D: 2048,
  maxUniformBufferBindingSize: 65536,
  maxUniformBuffersPerShaderStage: 12,
  maxVertexAttributes: 16,
  maxVertexBufferArrayStride: 2048,
  maxVertexBuffers: 8,
  minStorageBufferOffsetAlignment: 256,
  minUniformBufferOffsetAlignment: 256,
};

//
// const device = root.device; // Proxy<GPUDevice>
// const queue = device.queue; // Proxy<GPUQueue>
// const buffer = device.createBuffer(...); // Proxy<GPUBuffer>
// const renderPipeline = device.createRenderPipeline(...); // Proxy<GPURenderPipeline>
// // --- ACTIVATE ---
// // After activation, proxies should still be returned, as they have to handle unwrapping
// // prior made proxies when passed as arguments
// buffer; // Proxy<GPUBuffer>
// device.createBuffer(...); // Proxy<GPUBuffer>
//

const knownFakes = {
  'device': {
    'limits': () => ({ [RECORDING_PROXY]: true, ...FAKE_LIMITS }),
    'features': () => {
      const features = new Set<GPUFeatureName>();
      (features as any)[RECORDING_PROXY] = true;
      return features;
    },
  }
};

// TODO: Cache accessed prop proxies
export class RecordingDevice {
  #ops: RecordedOp[] = [];
  activated = false;

  #deviceProxy: GPUDevice;

  constructor() {
    this.#deviceProxy = this.#makeProxy('device', []) as GPUDevice;
    this.#ops = [];
  }

  get deviceProxy(): GPUDevice {
    return this.#deviceProxy;
  }

  // ---------------------------------------------------------------------------
  // Proxy factory
  // ---------------------------------------------------------------------------

  #makeProxy(type: 'device' | 'queue' | 'buffer' | 'unknown', accessPath: (string | symbol)[], initRealValue?: unknown): unknown {
    const base = (() => { }) as ((...args: never[]) => unknown) & Record<string | symbol, any>;
    base[RECORDING_PROXY] = true;
    base.label = type === 'device' ? 'ByeGL Recording Device' : undefined;
    if (initRealValue !== undefined) {
      base[REAL_VALUE] = initRealValue;
    }

    // Creating a callable proxy
    return new Proxy(base, {
      apply: (target, thisArg, args: never[]) => {
        let result: any;
        // We clear out the access path after a call
        if (accessPath[accessPath.length - 1] === 'createBuffer') {
          result = this.#makeProxy('buffer', []);
        } else {
          result = this.#makeProxy('unknown', []);
        }

        if (this.activated) {
          // Calling this function again once we're dealing with real values
          const realResult = unwrapProxy(target).apply(unwrapProxy(thisArg), args.map(unwrapProxiesDeep));
          if (typeof realResult !== 'function' && typeof realResult !== 'object') {
            // It's a primitive value, so we can return it directly
            result = realResult;
          } else {
            // The proxy now knows what it's real value is
            result[REAL_VALUE] = realResult;
          }
        } else {
          this.#ops.push(() => {
            // Calling this function again once we're dealing with real values
            const realResult = unwrapProxy(target).apply(unwrapProxy(thisArg), args.map(unwrapProxiesDeep));
            // The proxy now knows what it's real value is
            result[REAL_VALUE] = realResult;
          });
        }

        return result;
      },
      get: (_target, prop) => {
        const newAccessPath = [...accessPath, prop];
        // Proxy-specific props
        if (prop === RECORDING_PROXY || prop === REAL_VALUE || prop === 'label' || prop === 'then') {
          return Reflect.get(base, prop);
        }

        const target = this.activated ? base[REAL_VALUE] : base;

        // Capturing 'then' prevents Promise.resolve / async/await from treating this as a thenable
        if (prop === 'label' || prop === 'then') {
          return Reflect.get(target, prop);
        }

        if (prop in base) {
          // Already cached
          return base[prop];
        }

        let propProxy: any;
        const knownFake = (knownFakes as any)[type]?.[newAccessPath.join('.')];
        if (knownFake) {
          if (this.activated) {
            // We know this won't contain any nested proxies, so we don't need to proxy it further
            return base[REAL_VALUE][prop];
          } else {
            propProxy = knownFake();
            this.#ops.push(() => {
              const resultReal = base[REAL_VALUE][prop];
              // The proxy now knows what it's real value is
              propProxy[REAL_VALUE] = resultReal;
            });
          }
        } else {
          if (this.activated) {
            const realProp = base[REAL_VALUE][prop];
            if (typeof realProp !== 'function' && typeof realProp !== 'object') {
              // It's a primitive value, so we can return it directly
              return realProp;
            }
            propProxy = this.#makeProxy('unknown', newAccessPath, realProp);
          } else {
            propProxy = this.#makeProxy('unknown', newAccessPath);
            this.#ops.push(() => {
              const resultReal = base[REAL_VALUE][prop];
              // The proxy now knows what it's real value is
              propProxy[REAL_VALUE] = resultReal;
            });
          }
        }

        base[prop] = propProxy;
        return propProxy;
      },
      set: (_target, prop, value) => {
        if (prop === REAL_VALUE) {
          return Reflect.set(base, prop, value);
        }

        if (this.activated) {
          return Reflect.set(base[REAL_VALUE] as any, prop, value);
        }

        this.#ops.push(() => {
          if (base[REAL_VALUE]) {
            (base[REAL_VALUE] as any)[prop] = value
          }
        });
        return Reflect.set(base, prop, value);
      },
    }) as unknown as GPUDevice;
  }

  // ---------------------------------------------------------------------------
  // Activation: replay recorded ops on the real device
  // ---------------------------------------------------------------------------

  activate(realDevice: GPUDevice): void {
    (this.#deviceProxy as any)[REAL_VALUE] = realDevice;

    console.log('🥯🐶: Replaying commands recorded before activation...')
    for (const op of this.#ops) {
      op();
    }

    this.#ops = [];
    this.activated = true;
  }
}
