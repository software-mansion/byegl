<div align="center">

![byegl (light mode)](./media/byegl-logo-light.svg#gh-light-mode-only)
![byegl (dark mode)](./media/byegl-logo-dark.svg#gh-dark-mode-only)

**Migrate from WebGL to WebGPU, incrementally**

[Documentation](https://docs.swmansion.com/byegl)

</div>

## Intro

> Pronounced like "bagel" or "beagle", but with a "bye"

This project aims to reimplement the WebGL API on top of WebGPU, which will allow established WebGL-based projects to gradually migrate to the WebGPU over time (or in other words, to "de-WebGL their codebase")

## Getting Started

All you need to migrate your WebGL code to WebGPU is the following:

```ts
import * as byegl from 'byegl';

// Enable and await...
await byegl.enable();

// Intercepted by byegl 🥯🐶
const gl = canvas.getContext('webgl');
```

Enabling byegl will intercept calls to `.getContext('webgl' | 'webgl2' | 'experimental-webgl')` on all canvases and return
a virtualized WebGL context.

For more information, see the [documentation](https://docs.swmansion.com/byegl).

## Contributing

Contributions are welcome! Please read our [contributing guidelines](CONTRIBUTING.md) before submitting a pull request.

## Licence

This project is licensed under the MIT License.
