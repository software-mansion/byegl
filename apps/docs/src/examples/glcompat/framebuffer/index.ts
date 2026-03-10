import { mat4 } from 'gl-matrix';
import type { ExampleContext } from '../../types.ts';

// === Pass 1: Render a rotating triangle into an off-screen framebuffer ===

const triangleVertSrc = `
  attribute vec2 a_position;
  attribute vec3 a_color;
  varying vec3 v_color;
  uniform mat4 u_transform;
  void main() {
    gl_Position = u_transform * vec4(a_position, 0.0, 1.0);
    v_color = a_color;
  }
`;

const triangleFragSrc = `
  precision mediump float;
  varying vec3 v_color;
  void main() {
    gl_FragColor = vec4(v_color, 1.0);
  }
`;

// === Pass 2: Display the FBO texture on the canvas ===

const quadVertSrc = `
  attribute vec2 a_position;
  attribute vec2 a_uv;
  varying vec2 v_uv;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_uv = a_uv;
  }
`;

const quadFragSrc = `
  precision mediump float;
  uniform sampler2D u_texture;
  varying vec2 v_uv;
  void main() {
    vec2 distortion = sin(v_uv * 20.0) * 0.05;
    gl_FragColor = texture2D(u_texture, v_uv * 4.0 + distortion);
  }
`;

export default function ({ canvas }: ExampleContext) {
  const gl = canvas.getContext('webgl')!;
  if (!gl) throw new Error('WebGL not supported');

  function compileProgram(vertSrc: string, fragSrc: string): WebGLProgram {
    const vert = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vert, vertSrc);
    gl.compileShader(vert);
    if (!gl.getShaderParameter(vert, gl.COMPILE_STATUS)) {
      throw new Error(`Vertex shader error: ${gl.getShaderInfoLog(vert)}`);
    }

    const frag = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(frag, fragSrc);
    gl.compileShader(frag);
    if (!gl.getShaderParameter(frag, gl.COMPILE_STATUS)) {
      throw new Error(`Fragment shader error: ${gl.getShaderInfoLog(frag)}`);
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(prog)}`);
    }

    return prog;
  }

  // === Triangle program (pass 1) ===
  const triangleProg = compileProgram(triangleVertSrc, triangleFragSrc);
  const triPosLoc = gl.getAttribLocation(triangleProg, 'a_position');
  const triColorLoc = gl.getAttribLocation(triangleProg, 'a_color');
  const triTransformLoc = gl.getUniformLocation(triangleProg, 'u_transform');

  const triPosBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, triPosBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0.0, 0.8, -0.7, -0.5, 0.7, -0.5]),
    gl.STATIC_DRAW,
  );

  const triColorBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, triColorBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([1.0, 0.2, 0.2, 0.2, 1.0, 0.2, 0.2, 0.2, 1.0]),
    gl.STATIC_DRAW,
  );

  // === Quad program (pass 2) ===
  const quadProg = compileProgram(quadVertSrc, quadFragSrc);
  const quadPosLoc = gl.getAttribLocation(quadProg, 'a_position');
  const quadUvLoc = gl.getAttribLocation(quadProg, 'a_uv');
  const quadTexLoc = gl.getUniformLocation(quadProg, 'u_texture');

  // Slightly inset quad so the dark border shows this is an FBO texture
  const quadPosBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadPosBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-0.9, -0.9, 0.9, -0.9, -0.9, 0.9, 0.9, 0.9]),
    gl.STATIC_DRAW,
  );

  const quadUvBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadUvBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0]),
    gl.STATIC_DRAW,
  );

  // === Create the FBO color attachment texture ===
  const FBO_SIZE = 32;
  const fboTexture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, fboTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, FBO_SIZE, FBO_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

  // === Create and configure the FBO ===
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTexture, 0);

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    console.error('Framebuffer is not complete:', status);
  }

  // Return to the default framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  function animate(time: number) {
    handle = requestAnimationFrame(animate);

    // === Pass 1: Render rotating triangle to the FBO ===
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, FBO_SIZE, FBO_SIZE);
    gl.clearColor(0.05, 0.05, 0.1, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(triangleProg);

    const transform = mat4.create();
    mat4.rotateZ(transform, transform, time * 0.001);
    gl.uniformMatrix4fv(triTransformLoc, false, transform);

    gl.bindBuffer(gl.ARRAY_BUFFER, triPosBuffer);
    gl.enableVertexAttribArray(triPosLoc);
    gl.vertexAttribPointer(triPosLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, triColorBuffer);
    gl.enableVertexAttribArray(triColorLoc);
    gl.vertexAttribPointer(triColorLoc, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // === Pass 2: Display the FBO texture on the canvas ===
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0.02, 0.02, 0.02, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(quadProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fboTexture);
    gl.uniform1i(quadTexLoc, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, quadPosBuffer);
    gl.enableVertexAttribArray(quadPosLoc);
    gl.vertexAttribPointer(quadPosLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, quadUvBuffer);
    gl.enableVertexAttribArray(quadUvLoc);
    gl.vertexAttribPointer(quadUvLoc, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  let handle = requestAnimationFrame(animate);
  return () => {
    cancelAnimationFrame(handle);
  };
}
