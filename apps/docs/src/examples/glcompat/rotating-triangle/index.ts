export default function whiteTriangle(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl')!;

  if (!gl) {
    throw new Error('WebGL not supported');
  }

  const vertexShaderSource = `
    attribute vec2 a_position;
    uniform float u_time;

    void main() {
      vec2 local_pos = a_position * 0.5;
      float angle = u_time;
      vec2 up = vec2(-sin(angle), cos(angle));
      vec2 right = vec2(cos(angle), sin(angle));
      gl_Position = vec4(local_pos.x * right + local_pos.y * up, 0.0, 1.0);
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;
    void main() {
      gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
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

  const timeLocation = gl.getUniformLocation(program, 'u_time');
  const positionLocation = gl.getAttribLocation(program, 'a_position');
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, 0, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  function animate() {
    handle = requestAnimationFrame(animate);

    gl.useProgram(program);
    gl.uniform1f(timeLocation, performance.now() * 0.001);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  let handle = requestAnimationFrame(animate);

  return () => {
    cancelAnimationFrame(handle);
  };
}
