export default function (canvas: HTMLCanvasElement) {
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

  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      // bottom-left
      -1, -1,
      // bottom-right
      1, -1,
      // top-left
      -1, 1,
      // top-right
      1, 1,
    ]),
    gl.STATIC_DRAW,
  );

  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  const colorBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Uint8Array([
      // bottom-left
      255, 0, 0,
      // bottom-right
      255, 0, 255,
      // top-left
      0, 255, 0,
      // top-right
      0, 255, 255,
    ]),
    gl.STATIC_DRAW,
  );

  gl.enableVertexAttribArray(colorLocation);
  gl.vertexAttribPointer(colorLocation, 3, gl.UNSIGNED_BYTE, true, 0, 0);

  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(
    gl.ELEMENT_ARRAY_BUFFER,
    new Uint16Array([
      // first triangle
      0, 1, 2,
      // second triangle
      2, 1, 3,
    ]),
    gl.STATIC_DRAW,
  );

  gl.useProgram(program);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
}
