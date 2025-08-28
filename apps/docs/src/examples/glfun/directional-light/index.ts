/*
 * Based on a WebGL Fundamentals chapter:
 * https://webglfundamentals.org/webgl/lessons/webgl-3d-lighting-directional.html
 */

'use strict';

import { mat4, vec3 } from 'gl-matrix';
import type { ExampleContext } from '../../types.ts';

const vertexShader = /* glsl */ `
attribute vec4 a_position;
attribute vec3 a_normal;

uniform mat4 u_worldViewProjection;
uniform mat4 u_worldInverseTranspose;

varying vec3 v_normal;

void main() {
  // Multiply the position by the matrix.
  gl_Position = u_worldViewProjection * a_position;

  // orient the normals and pass to the fragment shader
  v_normal = mat3(u_worldInverseTranspose) * a_normal;
}
`;

const fragmentShader = /* glsl */ `
precision mediump float;

// Passed in from the vertex shader.
varying vec3 v_normal;

uniform vec3 u_reverseLightDirection;
uniform vec4 u_color;

void main() {
  // because v_normal is a varying it's interpolated
  // so it will not be a unit vector. Normalizing it
  // will make it a unit vector again
  vec3 normal = normalize(v_normal);

  float light = dot(normal, u_reverseLightDirection);

  gl_FragColor = u_color;

  // Lets multiply just the color portion (not the alpha)
  // by the light
  gl_FragColor.rgb *= light;
}
`;

export default function ({ canvas }: ExampleContext) {
  // Get A WebGL context
  const gl = canvas.getContext('webgl')!;
  if (!gl) {
    return;
  }

  // setup GLSL program
  const vert = gl.createShader(gl.VERTEX_SHADER)!;
  const frag = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(vert, vertexShader);
  gl.shaderSource(frag, fragmentShader);
  gl.compileShader(vert);
  gl.compileShader(frag);

  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);

  // look up where the vertex data needs to go.
  var positionLocation = gl.getAttribLocation(program, 'a_position');
  var normalLocation = gl.getAttribLocation(program, 'a_normal');

  // lookup uniforms
  var worldViewProjectionLocation = gl.getUniformLocation(
    program,
    'u_worldViewProjection',
  );
  var worldInverseTransposeLocation = gl.getUniformLocation(
    program,
    'u_worldInverseTranspose',
  );
  var colorLocation = gl.getUniformLocation(program, 'u_color');
  var reverseLightDirectionLocation = gl.getUniformLocation(
    program,
    'u_reverseLightDirection',
  );

  // Create a buffer to put positions in
  var positionBuffer = gl.createBuffer();
  // Bind it to ARRAY_BUFFER (think of it as ARRAY_BUFFER = positionBuffer)
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  // Put geometry data into buffer
  setGeometry(gl);

  // Create a buffer to put normals in
  var normalBuffer = gl.createBuffer();
  // Bind it to ARRAY_BUFFER (think of it as ARRAY_BUFFER = normalBuffer)
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
  // Put normals data into buffer
  setNormals(gl);

  function degToRad(d: number) {
    return (d * Math.PI) / 180;
  }

  var fieldOfViewRadians = degToRad(60);
  var fRotationRadians = 0;

  drawScene();

  // Draw the scene.
  function drawScene() {
    // Tell WebGL how to convert from clip space to pixels
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // Clear the canvas AND the depth buffer.
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Turn on culling. By default backfacing triangles
    // will be culled.
    gl.enable(gl.CULL_FACE);

    // Enable the depth buffer
    gl.enable(gl.DEPTH_TEST);

    // Tell it to use our program (pair of shaders)
    gl.useProgram(program);

    // Turn on the position attribute
    gl.enableVertexAttribArray(positionLocation);

    // Bind the position buffer.
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

    // Tell the position attribute how to get data out of positionBuffer (ARRAY_BUFFER)
    var size = 3; // 3 components per iteration
    var type = gl.FLOAT; // the data is 32bit floats
    var normalize = false; // don't normalize the data
    var stride = 0; // 0 = move forward size * sizeof(type) each iteration to get the next position
    var offset = 0; // start at the beginning of the buffer
    gl.vertexAttribPointer(
      positionLocation,
      size,
      type,
      normalize,
      stride,
      offset,
    );

    // Turn on the normal attribute
    gl.enableVertexAttribArray(normalLocation);

    // Bind the normal buffer.
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);

    // Tell the attribute how to get data out of normalBuffer (ARRAY_BUFFER)
    var size = 3; // 3 components per iteration
    var type = gl.FLOAT; // the data is 32bit floating point values
    var normalize = false; // normalize the data (convert from 0-255 to 0-1)
    var stride = 0; // 0 = move forward size * sizeof(type) each iteration to get the next position
    var offset = 0; // start at the beginning of the buffer
    gl.vertexAttribPointer(
      normalLocation,
      size,
      type,
      normalize,
      stride,
      offset,
    );

    // Compute the projection matrix
    var aspect = canvas.clientWidth / canvas.clientHeight;
    var zNear = 1;
    var zFar = 2000;
    var projectionMatrix = mat4.perspective(
      mat4.create(),
      fieldOfViewRadians,
      aspect,
      zNear,
      zFar,
    );

    // Compute the camera's matrix
    var camera = [100, 150, 200];
    var target = [0, 0, 0];
    var up = [0, 1, 0];
    const viewMatrix = mat4.create();

    // Make a view matrix from the camera matrix.
    mat4.lookAt(viewMatrix, camera, target, up);

    // Compute a view projection matrix
    var viewProjectionMatrix = mat4.multiply(
      mat4.create(),
      projectionMatrix,
      viewMatrix,
    );

    // Draw a F at the origin
    var worldMatrix = mat4.fromYRotation(mat4.create(), fRotationRadians);

    // Multiply the matrices.
    var worldViewProjectionMatrix = mat4.multiply(
      mat4.create(),
      viewProjectionMatrix,
      worldMatrix,
    );
    var worldInverseMatrix = mat4.invert(mat4.create(), worldMatrix)!;
    var worldInverseTransposeMatrix = mat4.transpose(
      mat4.create(),
      worldInverseMatrix,
    );

    // Set the matrices
    gl.uniformMatrix4fv(
      worldViewProjectionLocation,
      false,
      worldViewProjectionMatrix,
    );
    gl.uniformMatrix4fv(
      worldInverseTransposeLocation,
      false,
      worldInverseTransposeMatrix,
    );

    // Set the color to use
    gl.uniform4fv(colorLocation, [0.2, 1, 0.2, 1]); // green

    // set the light direction.
    gl.uniform3fv(
      reverseLightDirectionLocation,
      vec3.normalize(vec3.create(), [0.5, 0.7, 1]),
    );

    // Draw the geometry.
    var primitiveType = gl.TRIANGLES;
    var offset = 0;
    var count = 16 * 6;
    gl.drawArrays(primitiveType, offset, count);
  }

  function animate(timestamp: number) {
    handle = requestAnimationFrame(animate);
    fRotationRadians = timestamp * 0.001;
    drawScene();
  }
  let handle = requestAnimationFrame(animate);

  return () => {
    cancelAnimationFrame(handle);
  };
}

// Fill the buffer with the values that define a letter 'F'.
function setGeometry(gl: WebGLRenderingContext) {
  var positions = new Float32Array([
    // left column front
    0, 0, 0, 0, 150, 0, 30, 0, 0, 0, 150, 0, 30, 150, 0, 30, 0, 0,

    // top rung front
    30, 0, 0, 30, 30, 0, 100, 0, 0, 30, 30, 0, 100, 30, 0, 100, 0, 0,

    // middle rung front
    30, 60, 0, 30, 90, 0, 67, 60, 0, 30, 90, 0, 67, 90, 0, 67, 60, 0,

    // left column back
    0, 0, 30, 30, 0, 30, 0, 150, 30, 0, 150, 30, 30, 0, 30, 30, 150, 30,

    // top rung back
    30, 0, 30, 100, 0, 30, 30, 30, 30, 30, 30, 30, 100, 0, 30, 100, 30, 30,

    // middle rung back
    30, 60, 30, 67, 60, 30, 30, 90, 30, 30, 90, 30, 67, 60, 30, 67, 90, 30,

    // top
    0, 0, 0, 100, 0, 0, 100, 0, 30, 0, 0, 0, 100, 0, 30, 0, 0, 30,

    // top rung right
    100, 0, 0, 100, 30, 0, 100, 30, 30, 100, 0, 0, 100, 30, 30, 100, 0, 30,

    // under top rung
    30, 30, 0, 30, 30, 30, 100, 30, 30, 30, 30, 0, 100, 30, 30, 100, 30, 0,

    // between top rung and middle
    30, 30, 0, 30, 60, 30, 30, 30, 30, 30, 30, 0, 30, 60, 0, 30, 60, 30,

    // top of middle rung
    30, 60, 0, 67, 60, 30, 30, 60, 30, 30, 60, 0, 67, 60, 0, 67, 60, 30,

    // right of middle rung
    67, 60, 0, 67, 90, 30, 67, 60, 30, 67, 60, 0, 67, 90, 0, 67, 90, 30,

    // bottom of middle rung.
    30, 90, 0, 30, 90, 30, 67, 90, 30, 30, 90, 0, 67, 90, 30, 67, 90, 0,

    // right of bottom
    30, 90, 0, 30, 150, 30, 30, 90, 30, 30, 90, 0, 30, 150, 0, 30, 150, 30,

    // bottom
    0, 150, 0, 0, 150, 30, 30, 150, 30, 0, 150, 0, 30, 150, 30, 30, 150, 0,

    // left side
    0, 0, 0, 0, 0, 30, 0, 150, 30, 0, 0, 0, 0, 150, 30, 0, 150, 0,
  ]);

  // Center the F around the origin and Flip it around. We do this because
  // we're in 3D now with and +Y is up where as before when we started with 2D
  // we had +Y as down.

  // We could do by changing all the values above but I'm lazy.
  // We could also do it with a matrix at draw time but you should
  // never do stuff at draw time if you can do it at init time.
  const matrix = mat4.create();
  mat4.fromXRotation(matrix, Math.PI);
  mat4.translate(matrix, matrix, [-50, -75, -15]);

  let center = vec3.create();
  for (var ii = 0; ii < positions.length; ii += 3) {
    var vector = vec3.transformMat4(
      vec3.create(),
      [positions[ii + 0], positions[ii + 1], positions[ii + 2], 1],
      matrix,
    );
    positions[ii + 0] = vector[0];
    positions[ii + 1] = vector[1];
    positions[ii + 2] = vector[2];
    vec3.add(center, center, vector);
  }

  vec3.scale(center, center, 1 / positions.length);
  console.log(center);
  console.log(positions);

  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
}

function setNormals(gl: WebGLRenderingContext) {
  var normals = new Float32Array([
    // left column front
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,

    // top rung front
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,

    // middle rung front
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,

    // left column back
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,

    // top rung back
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,

    // middle rung back
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,

    // top
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,

    // top rung right
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,

    // under top rung
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,

    // between top rung and middle
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,

    // top of middle rung
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,

    // right of middle rung
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,

    // bottom of middle rung.
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,

    // right of bottom
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,

    // bottom
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,

    // left side
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
  ]);
  gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
}
