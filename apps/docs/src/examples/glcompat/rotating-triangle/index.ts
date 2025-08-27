import { mat4 } from 'gl-matrix';
import type { ExampleContext } from '../../types.ts';

export default function ({ canvas }: ExampleContext) {
  const gl = canvas.getContext('webgl')!;

  if (!gl) {
    throw new Error('WebGL not supported');
  }

  const vertexShaderSource = `
    attribute vec2 a_position;
    uniform mat4 u_worldMat;

    void main() {
      vec2 local_pos = a_position * 0.5;
      // float angle = u_time;
      // vec2 up = vec2(-sin(angle), cos(angle));
      // vec2 right = vec2(cos(angle), sin(angle));
      gl_Position = u_worldMat * vec4(local_pos, 0.0, 1.0);
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;
    uniform float u_time;

    void main() {
      gl_FragColor = vec4(sin(u_time), 1.0, cos(u_time), 1.0);
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
  const worldMatLocation = gl.getUniformLocation(program, 'u_worldMat');
  const positionLocation = gl.getAttribLocation(program, 'a_position');
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -Math.sin((2 * Math.PI) / 3),
      -0.5,
      Math.sin((2 * Math.PI) / 3),
      -0.5,
      0,
      1,
    ]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  function animate() {
    handle = requestAnimationFrame(animate);

    gl.useProgram(program);
    const transform = mat4.create();
    mat4.rotate(transform, transform, performance.now() * 0.001, [0, 0, 1]);

    gl.uniform1f(timeLocation, performance.now() * 0.001);
    gl.uniformMatrix4fv(worldMatLocation, false, transform);

    gl.clearColor(0, 0.2, 0.4, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  let handle = requestAnimationFrame(animate);

  return () => {
    cancelAnimationFrame(handle);
  };
}
