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

Use WGSL shaders in regular WebGL pipelines:

```ts
const program = degl.createProgram(wgslCode);
//    ^? DeGLProgram
```

## Tasks
- [ ] Buffer data
- [ ] Vertex attrib pointers

## API coverage
