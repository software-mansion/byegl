/*
 * Based on a WebGL Fundamentals chapter:
 * https://webglfundamentals.org/webgl/lessons/webgl-3d-orthographic.html
 */

import { mat4 } from 'gl-matrix';

const vertexShader = `
  attribute vec3 a_position;
  attribute vec3 a_color;

  uniform mat4 u_matrix;

  varying vec3 v_color;

  void main() {
    // Multiply the position by the matrix.
    gl_Position = u_matrix * vec4(a_position, 1);

    // Pass the color to the fragment shader.
    v_color = a_color;
  }
`;

const fragmentShader = `
  precision mediump float;

  // Passed in from the vertex shader.
  varying vec3 v_color;

  void main() {
    gl_FragColor = vec4(v_color, 1);
  }
`;

export default function main(canvas: HTMLCanvasElement) {
  // Get A WebGL context
  const gl = canvas.getContext('webgl')!;

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
  const positionLocation = gl.getAttribLocation(program, 'a_position');
  const colorLocation = gl.getAttribLocation(program, 'a_color');

  // Turn on the position and color attributes
  gl.enableVertexAttribArray(positionLocation);
  gl.enableVertexAttribArray(colorLocation);

  // lookup uniforms
  const matrixLocation = gl.getUniformLocation(program, 'u_matrix');

  // disabling program for now
  gl.useProgram(null);

  // Create a buffer to put positions in
  const positionBuffer = gl.createBuffer();
  // Bind it to ARRAY_BUFFER (think of it as ARRAY_BUFFER = positionBuffer)
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  // Put geometry data into buffer
  setGeometry(gl);

  // Create a buffer to put colors in
  const colorBuffer = gl.createBuffer();
  // Bind it to ARRAY_BUFFER (think of it as ARRAY_BUFFER = colorBuffer)
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  // Put geometry data into buffer
  setColors(gl);

  function radToDeg(r: number) {
    return (r * 180) / Math.PI;
  }

  function degToRad(d: number) {
    return (d * Math.PI) / 180;
  }

  var translation = [45, 150, 0];
  var rotation = [degToRad(40), degToRad(25), degToRad(325)];
  var scale = [1, 1, 1];

  function animate(timestamp: number) {
    handle = requestAnimationFrame(animate);

    rotation[0] = Math.sin(timestamp * 0.001);

    drawScene();
  }

  let handle = requestAnimationFrame(animate);

  // Draw the scene.
  function drawScene() {
    // Tell WebGL how to convert from clip space to pixels
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // Clear the canvas.
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Turn on culling. By default backfacing triangles
    // will be culled.
    gl.enable(gl.CULL_FACE);

    // Enable the depth buffer
    gl.enable(gl.DEPTH_TEST);

    // Bind the position buffer.
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

    // Tell the position attribute how to get data out of positionBuffer (ARRAY_BUFFER)
    {
      const size = 3; // 3 components per iteration
      const type = gl.FLOAT; // the data is 32bit floats
      const normalize = false; // don't normalize the data
      const stride = 0; // 0 = move forward size * sizeof(type) each iteration to get the next position
      const offset = 0; // start at the beginning of the buffer
      gl.vertexAttribPointer(
        positionLocation,
        size,
        type,
        normalize,
        stride,
        offset,
      );
    }

    // Bind the color buffer.
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);

    // Tell the attribute how to get data out of colorBuffer (ARRAY_BUFFER)
    {
      const size = 3; // 3 components per iteration
      const type = gl.UNSIGNED_BYTE; // the data is 8bit unsigned values
      const normalize = true; // normalize the data (convert from 0-255 to 0-1)
      const stride = 0; // 0 = move forward size * sizeof(type) each iteration to get the next position
      const offset = 0; // start at the beginning of the buffer
      gl.vertexAttribPointer(
        colorLocation,
        size,
        type,
        normalize,
        stride,
        offset,
      );
    }

    // Tell it to use our program (pair of shaders)
    gl.useProgram(program);

    // Compute the matrices
    let matrix = mat4.create();
    mat4.ortho(
      matrix,
      0,
      canvas.clientWidth,
      0,
      canvas.clientHeight,
      -1000,
      1000,
    );
    mat4.translate(matrix, matrix, translation);
    mat4.rotateX(matrix, matrix, rotation[0]);
    mat4.rotateY(matrix, matrix, rotation[1]);
    mat4.rotateZ(matrix, matrix, rotation[2]);
    mat4.scale(matrix, matrix, scale);

    // Set the matrix.
    gl.uniformMatrix4fv(matrixLocation, false, matrix);

    // Draw the geometry.
    var primitiveType = gl.TRIANGLES;
    var offset = 0;
    var count = 16 * 6;
    gl.drawArrays(primitiveType, offset, count);
  }

  return () => {
    cancelAnimationFrame(handle);
  };
}

// Fill the buffer with the values that define a letter 'F'.
function setGeometry(gl: WebGLRenderingContext) {
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
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
    ]),
    gl.STATIC_DRAW,
  );
}

// Fill the buffer with colors for the 'F'.
function setColors(gl: WebGLRenderingContext) {
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Uint8Array([
      // left column front
      200, 70, 120, 200, 70, 120, 200, 70, 120, 200, 70, 120, 200, 70, 120, 200,
      70, 120,

      // top rung front
      200, 70, 120, 200, 70, 120, 200, 70, 120, 200, 70, 120, 200, 70, 120, 200,
      70, 120,

      // middle rung front
      200, 70, 120, 200, 70, 120, 200, 70, 120, 200, 70, 120, 200, 70, 120, 200,
      70, 120,

      // left column back
      80, 70, 200, 80, 70, 200, 80, 70, 200, 80, 70, 200, 80, 70, 200, 80, 70,
      200,

      // top rung back
      80, 70, 200, 80, 70, 200, 80, 70, 200, 80, 70, 200, 80, 70, 200, 80, 70,
      200,

      // middle rung back
      80, 70, 200, 80, 70, 200, 80, 70, 200, 80, 70, 200, 80, 70, 200, 80, 70,
      200,

      // top
      70, 200, 210, 70, 200, 210, 70, 200, 210, 70, 200, 210, 70, 200, 210, 70,
      200, 210,

      // top rung right
      200, 200, 70, 200, 200, 70, 200, 200, 70, 200, 200, 70, 200, 200, 70, 200,
      200, 70,

      // under top rung
      210, 100, 70, 210, 100, 70, 210, 100, 70, 210, 100, 70, 210, 100, 70, 210,
      100, 70,

      // between top rung and middle
      210, 160, 70, 210, 160, 70, 210, 160, 70, 210, 160, 70, 210, 160, 70, 210,
      160, 70,

      // top of middle rung
      70, 180, 210, 70, 180, 210, 70, 180, 210, 70, 180, 210, 70, 180, 210, 70,
      180, 210,

      // right of middle rung
      100, 70, 210, 100, 70, 210, 100, 70, 210, 100, 70, 210, 100, 70, 210, 100,
      70, 210,

      // bottom of middle rung.
      76, 210, 100, 76, 210, 100, 76, 210, 100, 76, 210, 100, 76, 210, 100, 76,
      210, 100,

      // right of bottom
      140, 210, 80, 140, 210, 80, 140, 210, 80, 140, 210, 80, 140, 210, 80, 140,
      210, 80,

      // bottom
      90, 130, 110, 90, 130, 110, 90, 130, 110, 90, 130, 110, 90, 130, 110, 90,
      130, 110,

      // left side
      160, 160, 220, 160, 160, 220, 160, 160, 220, 160, 160, 220, 160, 160, 220,
      160, 160, 220,
    ]),
    gl.STATIC_DRAW,
  );
}
