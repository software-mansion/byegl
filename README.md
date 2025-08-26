<div align="center">

# 🦅 degl

Migrate from WebGL to WebGPU, incrementally

</div>

## Intro

> Pronounced like "deagle"

This project aims to reimplement the WebGL API on top of WebGPU, which will allow established WebGL-based projects to gradually migrate to the WebGPU over time (or in other words, to "de-GL their codebase")

[The API coverage can be seen here](#api-coverage).

## Hooks (draft)

Once your WebGL app is running on WebGPU through DeGL, you get direct access to WebGPU through hooks.

### Using WGSL in place of GLSL
```ts
const vertexShader = gl.createShader(gl.VERTEX_SHADER) as WebGLShader;
gl.shaderSource(vertexShader, vertexShaderSource);
gl.compileShader(vertexShader);

const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER) as WebGLShader;
gl.shaderSource(fragmentShader, fragmentShaderSource);
gl.compileShader(fragmentShader);

const program = gl.createProgram();
gl.attachShader(program, vertexShader);
gl.attachShader(program, fragmentShader);
gl.linkProgram(program);
```

The code above can be replaced with:

```ts
const program = degl.createWGSLProgram(gl, wgslCode);
//    ^? DeGLProgram
```

### Using a WebGPU buffer in WebGL

```ts
const device = degl.getDevice(gl);
//    ^? GPUDevice

// Using WebGPU to allocate a buffer
const wgpuBuffer = device.createBuffer({
  size: 4 * 4,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});

const buffer = degl.importWebGPUBuffer(gl, wgpuBuffer);
//    ^? WebGLBuffer
```

### Using a WebGPU texture in WebGL

```ts
const device = degl.getDevice(gl);
//    ^? GPUDevice

// Using WebGPU to allocate a texture
const wgpuTexture = device.createTexture({
  size: [32, 32],
  format: 'rgba8unorm',
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
});

const texture = degl.importWebGPUTexture(gl, wgpuTexture);
//    ^? WebGLTexture
```

## Things to consider when mixing GLSL and WGSL

WebGL's clip-space coordinates are in the range [-1, 1] for X, Y and Z, whereas WebGPU's clip-space Z coordinates are in the range [0, 1]. This is mitigated in the generated WGSL, but when writing your own WGSL shaders, you need to be aware of this difference.

## Tasks
- [ ] The `importWebGPUTexture` hook to import a WebGPU texture into WebGL
- [ ] Merge WebGL and WebGL2 entry-points into one, as they don't have many deviations

## API coverage
