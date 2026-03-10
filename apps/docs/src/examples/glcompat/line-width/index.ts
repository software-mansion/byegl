import type { ExampleContext } from '../../types.ts';

/**
 * Demonstrates gl.lineWidth by drawing a set of concentric star polygons,
 * each ring rendered with a progressively thicker line width.
 *
 * Note: WebGPU does not expose variable line widths, so all lines are clamped
 * to 1 px regardless of the value passed to gl.lineWidth(). The API is fully
 * state-tracked — gl.getParameter(gl.LINE_WIDTH) returns the last set value —
 * and the call never throws, matching the WebGL specification.
 */
export default function lineWidthExample({ canvas }: ExampleContext) {
  const gl = canvas.getContext('webgl')!;

  if (!gl) {
    throw new Error('WebGL not supported');
  }

  const vertexShaderSource = `
    attribute vec2 a_position;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;
    uniform vec4 u_color;

    void main() {
      gl_FragColor = u_color;
    }
  `;

  const vs = gl.createShader(gl.VERTEX_SHADER) as WebGLShader;
  gl.shaderSource(vs, vertexShaderSource);
  gl.compileShader(vs);

  const fs = gl.createShader(gl.FRAGMENT_SHADER) as WebGLShader;
  gl.shaderSource(fs, fragmentShaderSource);
  gl.compileShader(fs);

  const program = gl.createProgram() as WebGLProgram;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.useProgram(program);

  const posLoc = gl.getAttribLocation(program, 'a_position');
  const colorLoc = gl.getUniformLocation(program, 'u_color');

  /**
   * Builds a closed star-polygon as a LINE_STRIP vertex list.
   * The first vertex is repeated at the end so the strip forms a closed loop.
   */
  function buildStar(points: number, innerRadius: number, scale: number): Float32Array {
    const total = points * 2;
    const verts: number[] = [];
    for (let i = 0; i <= total; i++) {
      const idx = i % total;
      const angle = (idx / total) * Math.PI * 2 - Math.PI / 2;
      const r = (idx % 2 === 0 ? 1.0 : innerRadius) * scale;
      verts.push(Math.cos(angle) * r, Math.sin(angle) * r);
    }
    return new Float32Array(verts);
  }

  const rings = [
    { points: 3, inner: 0.45, scale: 0.18, lineWidth: 1, color: [1.0, 0.35, 0.35, 1.0] },
    { points: 4, inner: 0.55, scale: 0.24, lineWidth: 2, color: [1.0, 0.65, 0.2, 1.0] },
    { points: 5, inner: 0.45, scale: 0.3, lineWidth: 3, color: [0.95, 0.95, 0.2, 1.0] },
    { points: 6, inner: 0.6, scale: 0.36, lineWidth: 4, color: [0.3, 0.95, 0.45, 1.0] },
    { points: 7, inner: 0.45, scale: 0.42, lineWidth: 5, color: [0.2, 0.8, 1.0, 1.0] },
    { points: 8, inner: 0.65, scale: 0.48, lineWidth: 6, color: [0.55, 0.35, 1.0, 1.0] },
  ] as const;

  // One GPU buffer per ring (reused every frame with DYNAMIC_DRAW)
  const ringBuffers = rings.map(() => gl.createBuffer() as WebGLBuffer);

  gl.enableVertexAttribArray(posLoc);

  let animId: number;

  function render(t: number) {
    gl.clearColor(0.04, 0.04, 0.1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const rotationSpeed = 0.0003;

    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i];

      // Alternate rotation direction per ring
      const angle = t * rotationSpeed * (i % 2 === 0 ? 1 : -1) * (1 + i * 0.12);
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      const base = buildStar(ring.points, ring.inner, ring.scale);
      const rotated = new Float32Array(base.length);
      for (let j = 0; j < base.length; j += 2) {
        const x = base[j]!;
        const y = base[j + 1]!;
        rotated[j] = x * cosA - y * sinA;
        rotated[j + 1] = x * sinA + y * cosA;
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, ringBuffers[i]!);
      gl.bufferData(gl.ARRAY_BUFFER, rotated, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      gl.uniform4fv(colorLoc, ring.color);

      // Request the line width for this ring.
      // WebGPU clamps this to 1 px; on native WebGL the rings would visibly
      // thicken from the innermost (1 px) to the outermost (6 px).
      gl.lineWidth(ring.lineWidth);

      // LINE_STRIP with the first vertex duplicated at the end forms a closed ring.
      gl.drawArrays(gl.LINE_STRIP, 0, rotated.length / 2);
    }

    animId = requestAnimationFrame(render);
  }

  animId = requestAnimationFrame(render);

  return () => cancelAnimationFrame(animId);
}
