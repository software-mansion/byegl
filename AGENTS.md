# byegl Agent Guidelines

Guidelines for coding agents working in the byegl repository—a WebGL-to-WebGPU compatibility library.

## Quick Reference

```bash
pnpm install          # Install dependencies
pnpm dev              # Start docs dev server
pnpm test:ci          # Run all CI checks (style, node tests, types)
pnpm test:node        # Run Node.js tests (jsdom)
pnpm test:browser     # Run browser tests (webdriverio/chrome)
pnpm test:style       # Run Biome linting/formatting
pnpm test:types       # TypeScript type checking
pnpm fix              # Auto-fix linting/formatting issues
```

## Monorepo Structure

```
├── packages/byegl/           # Main library
│   ├── src/
│   │   ├── index.ts          # Entry point & public API (enable, getDevice, etc.)
│   │   ├── byegl-context.ts  # Core WebGL context implementation
│   │   ├── buffer.ts         # WebGL buffer → WebGPU buffer
│   │   ├── program.ts        # Shader program handling
│   │   ├── uniform.ts        # Uniform location management
│   │   ├── texture.ts        # Texture handling
│   │   ├── attribute.ts      # Vertex attribute handling
│   │   ├── framebuffer.ts    # Framebuffer implementation
│   │   ├── errors.ts         # Custom error classes
│   │   ├── types.ts          # Type definitions & $internal symbol
│   │   └── wgsl/             # GLSL → WGSL shader generation
│   │       ├── shaderkit-wgsl-generator.ts  # Production generator
│   │       └── mock-wgsl-generator.ts       # Test mock
│   └── tests/
│       ├── *.test.ts              # Node tests (run with jsdom)
│       ├── *.test.browser.ts      # Browser tests (run with Chrome)
│       ├── extendedTest.ts        # Test fixtures & helpers
│       └── setup.ts               # Node test setup (WebGL mocks)
├── apps/docs/                # Astro documentation site
│   └── src/examples/         # Interactive examples
├── biome.json                # Linting/formatting config
└── vitest.config.mjs         # Test configuration
```

## Running Tests

```bash
# Run specific test file
pnpm test:node -- packages/byegl/tests/uniforms.test.ts

# Run tests matching a pattern
pnpm test:node -- --grep "uniform location"

# Watch mode
pnpm test:node -- --watch

# Browser tests (opens Chrome)
pnpm test:browser -- packages/byegl/tests/remap.test.browser.ts
```

## Building

```bash
# Build main library
cd packages/byegl && pnpm build

# Build docs site
cd apps/docs && pnpm build
```

## Before Committing

Always run:
```bash
pnpm test:ci && cd packages/byegl && pnpm build
```

## Code Style

### TypeScript

- **Target**: ES2020, ESNext modules, bundler resolution
- **Strict mode**: Enabled
- **Import extensions**: Always use `.ts` extensions
- **WebGPU types**: Via `@webgpu/types`

### Imports

```typescript
// Always use .ts extensions
import { ByeGLContext } from './byegl-context.ts';
import { $internal } from './types.ts';

// Type-only imports when appropriate
import type { WebGLBuffer } from './types.ts';

// External imports first, then internal (Biome auto-organizes)
import tgpu from 'typegpu';
import { ByeGLBuffer } from './buffer.ts';
```

### Formatting (Biome)

- Single quotes
- 2-space indentation
- Semicolons required
- Trailing commas (ES5 style)

### Naming

- **Classes**: `PascalCase` (e.g., `ByeGLContext`, `ShaderCompilationError`)
- **Functions/Variables**: `camelCase`
- **Internal properties**: Use `$internal` symbol from `types.ts`

### Error Handling

```typescript
// Custom errors in errors.ts
export class NotImplementedYetError extends Error {
  constructor(feature: string) {
    super(`Feature '${feature}' is not implemented yet...`);
    Object.setPrototypeOf(this, NotImplementedYetError.prototype);
  }
}

// Validation pattern
if (!(gl instanceof ByeGLContext)) {
  throw new Error('Cannot use byegl hooks on a vanilla WebGL context');
}
```

### JSDoc

Document public API functions:

```typescript
/**
 * Returns the WebGPU buffer associated with the given WebGL buffer.
 * Since byegl might reallocate the buffer if the size of the data changes,
 * call this function each time you need access.
 *
 * @param gl The WebGL (actually byegl) context.
 * @param glBuffer
 * @returns The WebGPU buffer associated with `glBuffer`.
 */
export function getWebGPUBuffer(...): GPUBuffer { }
```

## Testing Patterns

### Test Structure

Tests use Vitest with custom fixtures from `extendedTest.ts`:

```typescript
import { describe, expect } from 'vitest';
import { test, toWgsl } from './extendedTest.ts';

describe('float uniform', () => {
  test('shader generation', ({ gl }) => {
    const { wgsl } = toWgsl(gl, vertShader, fragShader);
    expect(wgsl).toMatchInlineSnapshot(`...`);
  });
});
```

### Available Test Fixtures

- `gl` - Mocked WebGL2RenderingContext (ByeGLContext instance)
- `device` - Mocked GPUDevice
- `root` - TgpuRoot instance
- `commandEncoder` - Mocked GPUCommandEncoder

### Helper Functions

- `toWgsl(gl, glslVert, glslFrag)` - Compiles GLSL to WGSL, returns `{ wgsl, program }`

### Inline Snapshots

Prefer inline snapshots for generated code:

```typescript
expect(wgsl).toMatchInlineSnapshot(`
  "// Generated by byegl
  @group(0) @binding(0) var<uniform> uFoo: f32;
  "
`);
```

## Key Concepts

### Internal Properties

Access internal state via the `$internal` symbol:

```typescript
import { $internal } from './types.ts';

// Access internal buffer state
const gpuBuffer = (glBuffer as ByeGLBuffer)[$internal].gpuBuffer;

// Access context internals
const device = gl[$internal].device;
```

### Shader Compilation

- GLSL → WGSL translation via `@iwoplaza/shaderkit`
- Generator in `src/wgsl/shaderkit-wgsl-generator.ts`
- Uniforms get automatic `@group(0) @binding(N)` assignments

### Context Interception

`byegl.enable()` patches `HTMLCanvasElement.prototype.getContext` to return `ByeGLContext` instead of native WebGL contexts.

## Commit Messages

Use conventional commits:

```
feat: add support for WebGL2 uniform blocks
fix: correct matrix uniform alignment in WGSL output
test: add browser tests for texture sampling
refactor: extract shader compilation logic
docs: update API documentation
chore: update dependencies
```

## Dependencies

### Runtime
- `typegpu` - WebGPU type system for shader generation
- `@iwoplaza/shaderkit` - GLSL → WGSL translation

### Dev
- `@webgpu/types` - WebGPU TypeScript types
- `tsdown` - Build tool with typegpu plugin
- `webgl-constants` - WebGL constant values for tests

## Prerequisites

- Node.js 22.x+
- pnpm 10.x+
