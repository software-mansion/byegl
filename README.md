# DeGL
> Pronounced like "deagle"

This project aims to reimplement the WebGL API on top of WebGPU, which will allow established WebGL-based projects to gradually migrate to the WebGPU over time.
[The API coverage can be seen here](#api-coverage).

# Package name ideas:
- webgl-on-webgpu
- wgpu-gl
- webgpu-gl
- degl
- ungl

# Tasks
- [x] Scaffold project (the core package, and an example app)
- [ ] Create functions to polyfill `.getContext('webgl')` and `.getContext('webgl2')` (no-ops for now)
- [ ] Write the simplest WebGL example (white triangle), and try to make it run on the compat layer (backed by WebGPU)

# API coverage
