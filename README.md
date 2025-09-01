<div align="center">

# 🥯🐶 byegl

Migrate from WebGL to WebGPU, incrementally

</div>

## Intro

> Pronounced like "bagel" or "beagle", but with a "bye"

This project aims to reimplement the WebGL API on top of WebGPU, which will allow established WebGL-based projects to gradually migrate to the WebGPU over time (or in other words, to "de-WebGL their codebase")

## Hooks

Once your WebGL app is running on WebGPU through byegl, you get direct access to WebGPU through hooks.

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
const program = byegl.createWGSLProgram(gl, wgslCode);
//    ^? ByeGLProgram
```

### Using a WebGPU buffer in WebGL

```ts
const device = byegl.getDevice(gl);
//    ^? GPUDevice

// Using WebGPU to allocate a buffer
const wgpuBuffer = device.createBuffer({
  size: 4 * 4,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});

const buffer = byegl.importWebGPUBuffer(gl, wgpuBuffer);
//    ^? WebGLBuffer
```

## Things to consider when mixing GLSL and WGSL

WebGL's clip-space coordinates are in the range [-1, 1] for X, Y and Z, whereas WebGPU's clip-space Z coordinates are in the range [0, 1]. This is mitigated in the generated WGSL, but when writing your own WGSL shaders, you need to be aware of this difference.
