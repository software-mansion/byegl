import type { ExampleContext } from '../../types.ts';

/**
 * Demonstrates gl.bufferSubData by packing three independently-animated
 * polygons into a single shared vertex buffer.
 *
 * The buffer is allocated once with gl.bufferData(…, size, gl.DYNAMIC_DRAW),
 * then each frame only the section that belongs to a given polygon is
 * overwritten via gl.bufferSubData(gl.ARRAY_BUFFER, byteOffset, newData).
 * gl.vertexAttribPointer is called with a matching byte offset so that each
 * draw call reads from its own region of the shared buffer.
 */
export default function bufferSubDataExample({ canvas }: ExampleContext) {
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

  // Three shapes that will share a single vertex buffer, each spinning at a
  // different rate and drawn in a different colour.
  const shapes = [
    { sides: 3, cx: -0.6, cy: 0, scale: 0.28, speed: 1.4, color: [1.0, 0.35, 0.35, 1.0] },
    { sides: 5, cx: 0.0, cy: 0, scale: 0.28, speed: 0.7, color: [0.35, 1.0, 0.45, 1.0] },
    { sides: 8, cx: 0.6, cy: 0, scale: 0.28, speed: 0.3, color: [0.35, 0.65, 1.0, 1.0] },
  ];

  // Each polygon is rendered as a LINE_STRIP with (sides + 1) vertices so that
  // the last vertex closes back to the first.  Two floats per vertex.
  const FLOATS_PER_VERTEX = 2;
  const BYTES_PER_FLOAT = Float32Array.BYTES_PER_ELEMENT; // 4
  const BYTES_PER_VERTEX = FLOATS_PER_VERTEX * BYTES_PER_FLOAT; // 8

  // Compute the byte offset of each shape's section within the shared buffer.
  const byteOffsets: number[] = [];
  let totalBytes = 0;
  for (const shape of shapes) {
    byteOffsets.push(totalBytes);
    totalBytes += (shape.sides + 1) * BYTES_PER_VERTEX;
  }

  // Allocate the buffer once — no data yet, just reserve the space.
  const sharedBuffer = gl.createBuffer() as WebGLBuffer;
  gl.bindBuffer(gl.ARRAY_BUFFER, sharedBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, totalBytes, gl.DYNAMIC_DRAW);

  gl.enableVertexAttribArray(posLoc);

  /** Writes a regular n-gon's vertices (closed) into `out` starting at index 0. */
  function writePolygon(
    out: Float32Array,
    sides: number,
    cx: number,
    cy: number,
    scale: number,
    angle: number,
  ): void {
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2 + angle;
      out[i * 2] = cx + Math.cos(a) * scale;
      out[i * 2 + 1] = cy + Math.sin(a) * scale;
    }
  }

  // Reuse typed arrays to avoid per-frame allocations.
  const scratchBuffers = shapes.map((s) => new Float32Array((s.sides + 1) * FLOATS_PER_VERTEX));

  let animId: number;

  function render(t: number) {
    gl.clearColor(0.04, 0.04, 0.1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    for (let i = 0; i < shapes.length; i++) {
      const shape = shapes[i]!;
      const scratch = scratchBuffers[i]!;
      const byteOffset = byteOffsets[i]!;

      // Compute new vertex positions for this frame.
      writePolygon(scratch, shape.sides, shape.cx, shape.cy, shape.scale, t * 0.001 * shape.speed);

      // Upload only this shape's section — the rest of the buffer is untouched.
      gl.bufferSubData(gl.ARRAY_BUFFER, byteOffset, scratch);

      // Point the position attribute at this shape's region of the shared buffer.
      gl.vertexAttribPointer(posLoc, FLOATS_PER_VERTEX, gl.FLOAT, false, 0, byteOffset);

      gl.uniform4fv(colorLoc, shape.color);
      gl.drawArrays(gl.LINE_STRIP, 0, shape.sides + 1);
    }

    animId = requestAnimationFrame(render);
  }

  animId = requestAnimationFrame(render);

  return () => cancelAnimationFrame(animId);
}
