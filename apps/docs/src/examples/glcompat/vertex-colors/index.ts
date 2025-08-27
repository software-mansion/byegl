import type { ExampleContext } from '../../types.ts';

export default function ({ canvas }: ExampleContext) {
  const gl = canvas.getContext('webgl');

  if (!gl) {
    throw new Error('WebGL not supported');
  }

  const vertexShaderSource = `
    attribute vec2 a_position;
    attribute vec3 a_color;

    varying vec3 v_color;

    void main() {
      gl_Position = vec4(a_position * 0.5, 0.0, 1.0);
      v_color = a_color;
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;
    varying vec3 v_color;
    void main() {
      gl_FragColor = vec4(v_color, 1.0);
    }
  `;

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

  const positionLocation = gl.getAttribLocation(program, 'a_position');
  const colorLocation = gl.getAttribLocation(program, 'a_color');
  // A buffer holding both the position and color attributes
  const attribBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, attribBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      // positions
      -1, -1, 1, -1, -1, 1,
      // colors
      1, 0, 0, 0, 1, 0, 0, 0, 1,
    ]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(positionLocation);
  gl.enableVertexAttribArray(colorLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 0, 6 * 4);

  gl.useProgram(program);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
