import type { ExampleContext } from '../../types.ts';

export default function scissorExample({ canvas }: ExampleContext) {
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
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  // Two triangles covering the full clip space
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  const colorLoc = gl.getUniformLocation(program, 'u_color');

  const NUM_BARS = 8;
  const colors: [number, number, number, number][] = [
    [1.0, 0.25, 0.25, 1],
    [1.0, 0.55, 0.1, 1],
    [1.0, 0.9, 0.1, 1],
    [0.25, 0.9, 0.25, 1],
    [0.1, 0.85, 0.85, 1],
    [0.25, 0.45, 1.0, 1],
    [0.65, 0.2, 1.0, 1],
    [1.0, 0.25, 0.8, 1],
  ];

  let animId: number;

  function render(t: number) {
    const w = canvas.width;
    const h = canvas.height;
    const barWidth = Math.floor(w / NUM_BARS);

    // Clear the full canvas without scissor
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0.05, 0.05, 0.1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Draw each bar restricted to its own scissor rectangle
    gl.enable(gl.SCISSOR_TEST);

    for (let i = 0; i < NUM_BARS; i++) {
      const phase = (i / NUM_BARS) * Math.PI * 2;
      const barHeight = Math.round(h * 0.1 + h * 0.8 * (0.5 + 0.5 * Math.sin(t * 0.001 + phase)));

      const x = i * barWidth;
      // Last bar takes any remaining pixels to avoid gaps from rounding
      const bw = i === NUM_BARS - 1 ? w - x : barWidth;

      // y=0 is the bottom in WebGL coordinates
      gl.scissor(x, 0, bw, barHeight);
      gl.uniform4fv(colorLoc, colors[i]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    animId = requestAnimationFrame(render);
  }

  animId = requestAnimationFrame(render);

  return () => cancelAnimationFrame(animId);
}
