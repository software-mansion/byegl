import { mat4 } from 'gl-matrix';
import { loadTexture } from '../../_common/loadTexture.ts';
import type { ExampleContext } from '../../types.ts';
import crateUrl from './RTS_Crate.png';

const vertexShaderSource = `
  attribute vec3 a_position;
  attribute vec2 a_uv;

  varying vec2 v_uv;

  uniform mat4 u_mvpMatrix;

  void main() {
    gl_Position = u_mvpMatrix * vec4(a_position * 0.5, 1.0);
    v_uv = a_uv;
  }
`;

const fragmentShaderSource = `
  precision mediump float;

  varying vec2 v_uv;

  uniform sampler2D u_texture;

  void main() {
    vec4 color = texture2D(u_texture, v_uv);
    gl_FragColor = vec4(color.rgb, 1.0);
  }
`;

export default async function ({ canvas }: ExampleContext) {
  const gl = canvas.getContext('webgl')!;

  if (!gl) {
    throw new Error('WebGL not supported');
  }

  // Load texture
  const texture = await loadTexture(gl, crateUrl.src);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture.texture);

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
  gl.useProgram(program);

  const positionLocation = gl.getAttribLocation(program, 'a_position');
  const uvLocation = gl.getAttribLocation(program, 'a_uv');
  const mvpMatrixLocation = gl.getUniformLocation(program, 'u_mvpMatrix');
  const textureLocation = gl.getUniformLocation(program, 'u_texture');

  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      ...[
        1, -1, -1 /* bl */, 1, 1, -1 /* br */, 1, -1, 1 /* tl */, 1, 1,
        1 /* tr */,
      ], // X+
      ...[
        -1, -1, -1 /* bl */, -1, 1, -1 /* br */, -1, -1, 1 /* tl */, -1, 1,
        1 /* tr */,
      ], // X-
      ...[
        -1, 1, -1 /* bl */, 1, 1, -1 /* br */, -1, 1, 1 /* tl */, 1, 1,
        1 /* tr */,
      ], // Y+
      ...[
        -1, -1, -1 /* bl */, 1, -1, -1 /* br */, -1, -1, 1 /* tl */, 1, -1,
        1 /* tr */,
      ], // Y-
      ...[
        -1, -1, 1 /* bl */, 1, -1, 1 /* br */, -1, 1, 1 /* tl */, 1, 1,
        1 /* tr */,
      ], // Z+
      ...[
        -1, -1, -1 /* bl */, 1, -1, -1 /* br */, -1, 1, -1 /* tl */, 1, 1,
        -1 /* tr */,
      ], // Z-
    ]),
    gl.STATIC_DRAW,
  );

  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);

  const uvBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      ...[0, 0, /* bl */ 1, 0 /* br */, 0, 1 /* tl */, 1, 1 /* tr */], // X+
      ...[0, 0, /* bl */ 1, 0 /* br */, 0, 1 /* tl */, 1, 1 /* tr */], // X-
      ...[0, 0, /* bl */ 1, 0 /* br */, 0, 1 /* tl */, 1, 1 /* tr */], // Y+
      ...[0, 0, /* bl */ 1, 0 /* br */, 0, 1 /* tl */, 1, 1 /* tr */], // Y-
      ...[0, 0, /* bl */ 1, 0 /* br */, 0, 1 /* tl */, 1, 1 /* tr */], // Z+
      ...[0, 0, /* bl */ 1, 0 /* br */, 0, 1 /* tl */, 1, 1 /* tr */], // Z-
    ]),
    gl.STATIC_DRAW,
  );

  gl.enableVertexAttribArray(uvLocation);
  gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0);

  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(
    gl.ELEMENT_ARRAY_BUFFER,
    new Uint16Array([
      // X+
      0, 1, 2, 2, 1, 3,
      // X-
      5, 4, 6, 5, 6, 7,
      // Y+
      8, 10, 9, 9, 10, 11,
      // Y-
      12, 13, 14, 14, 13, 15,
      // Z+
      16, 17, 18, 18, 17, 19,
      // Z-
      21, 20, 22, 21, 22, 23,
    ]),
    gl.STATIC_DRAW,
  );

  const modelMatrix = mat4.create();

  const projectionMatrix = mat4.create();
  mat4.perspective(
    projectionMatrix,
    Math.PI / 4,
    canvas.width / canvas.height,
    0.1,
    100,
  );

  const mvpMatrix = mat4.create();

  function animate(timestamp: number) {
    handle = requestAnimationFrame(animate);

    mat4.identity(modelMatrix);
    mat4.translate(modelMatrix, modelMatrix, [0, 0, -4]);
    mat4.rotateY(modelMatrix, modelMatrix, timestamp * 0.001);
    mat4.rotateX(modelMatrix, modelMatrix, timestamp * 0.0007 + 0.1);
    mat4.multiply(mvpMatrix, projectionMatrix, modelMatrix);

    gl.enable(gl.CULL_FACE);
    gl.uniform1i(textureLocation, 0);
    gl.uniformMatrix4fv(mvpMatrixLocation, false, mvpMatrix);

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawElements(gl.TRIANGLES, 6 * 6, gl.UNSIGNED_SHORT, 0);
  }

  let handle = requestAnimationFrame(animate);

  return () => {
    cancelAnimationFrame(handle);
  };
}
