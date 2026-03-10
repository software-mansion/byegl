import { mat4 } from 'gl-matrix';
import type { ExampleContext } from '../../types.ts';

/**
 * Demonstrates gl.createRenderbuffer / gl.renderbufferStorage by building an
 * FBO with a colour-texture attachment *and* a depth-renderbuffer attachment,
 * then rendering a 3-D scene into it.
 *
 * The classic use-case for a renderbuffer (vs a texture) is exactly this:
 * you need depth-testing on an off-screen pass but you never intend to sample
 * the depth values in a shader — a renderbuffer is the correct, lightweight
 * choice.  Without the depth renderbuffer the back faces of the cube would
 * bleed through the front faces; with it they are correctly occluded.
 *
 * Pass 1 — render a spinning cube into the FBO (colour tex + depth RBO).
 * Pass 2 — display the FBO colour texture on the canvas with a ripple effect.
 */

// ─── Shaders ───────────────────────────────────────────────────────────────

const cubeVertSrc = `
  attribute vec3 a_position;
  attribute vec3 a_color;
  varying   vec3 v_color;
  uniform   mat4 u_mvp;

  void main() {
    gl_Position = u_mvp * vec4(a_position, 1.0);
    v_color     = a_color;
  }
`;

const cubeFragSrc = `
  precision mediump float;
  varying vec3 v_color;

  void main() {
    gl_FragColor = vec4(v_color, 1.0);
  }
`;

const quadVertSrc = `
  attribute vec2 a_position;
  attribute vec2 a_uv;
  varying   vec2 v_uv;

  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_uv        = a_uv;
  }
`;

const quadFragSrc = `
  precision mediump float;
  uniform sampler2D u_texture;
  uniform float     u_time;
  varying vec2      v_uv;

  void main() {
    float wave = sin(v_uv.x * 18.0 + u_time) * 0.012
               + sin(v_uv.y * 14.0 - u_time * 0.7) * 0.012;
    gl_FragColor = texture2D(u_texture, v_uv + vec2(wave));
  }
`;

// ─── Geometry ──────────────────────────────────────────────────────────────

// prettier-ignore
const cubePositions = new Float32Array([
  // front
  -1,-1, 1,   1,-1, 1,   1, 1, 1,  -1, 1, 1,
  // back
  -1,-1,-1,  -1, 1,-1,   1, 1,-1,   1,-1,-1,
  // top
  -1, 1,-1,  -1, 1, 1,   1, 1, 1,   1, 1,-1,
  // bottom
  -1,-1,-1,   1,-1,-1,   1,-1, 1,  -1,-1, 1,
  // right
   1,-1,-1,   1, 1,-1,   1, 1, 1,   1,-1, 1,
  // left
  -1,-1,-1,  -1,-1, 1,  -1, 1, 1,  -1, 1,-1,
]);

// prettier-ignore
const cubeColors = new Float32Array([
  // front  — red
  1,.2,.2, 1,.2,.2, 1,.2,.2, 1,.2,.2,
  // back   — cyan
  .2,.9,.9, .2,.9,.9, .2,.9,.9, .2,.9,.9,
  // top    — green
  .2,.9,.2, .2,.9,.2, .2,.9,.2, .2,.9,.2,
  // bottom — magenta
  .9,.2,.9, .9,.2,.9, .9,.2,.9, .9,.2,.9,
  // right  — blue
  .2,.4,1, .2,.4,1, .2,.4,1, .2,.4,1,
  // left   — yellow
  1,.9,.2, 1,.9,.2, 1,.9,.2, 1,.9,.2,
]);

// Two triangles per face, six faces
// prettier-ignore
const cubeIndices = new Uint16Array([
   0, 1, 2,  0, 2, 3,   // front
   4, 5, 6,  4, 6, 7,   // back
   8, 9,10,  8,10,11,   // top
  12,13,14, 12,14,15,   // bottom
  16,17,18, 16,18,19,   // right
  20,21,22, 20,22,23,   // left
]);

// Full-screen quad
// prettier-ignore
const quadPositions = new Float32Array([-1,-1,  1,-1,  -1,1,  1,1]);
// prettier-ignore
const quadUVs       = new Float32Array([ 0, 0,  1, 0,   0,1,  1,1]);

// ─── Example ───────────────────────────────────────────────────────────────

export default function renderbufferExample({ canvas }: ExampleContext) {
  const gl = canvas.getContext('webgl')!;
  if (!gl) throw new Error('WebGL not supported');

  // ── helpers ──────────────────────────────────────────────────────────────

  function compileProgram(vertSrc: string, fragSrc: string): WebGLProgram {
    const vert = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vert, vertSrc);
    gl.compileShader(vert);

    const frag = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(frag, fragSrc);
    gl.compileShader(frag);

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    return prog;
  }

  function uploadBuffer(data: Float32Array | Uint16Array, target: GLenum): WebGLBuffer {
    const buf = gl.createBuffer()!;
    gl.bindBuffer(target, buf);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return buf;
  }

  // ── programs ─────────────────────────────────────────────────────────────

  const cubeProg = compileProgram(cubeVertSrc, cubeFragSrc);
  const cubePosLoc = gl.getAttribLocation(cubeProg, 'a_position');
  const cubeColLoc = gl.getAttribLocation(cubeProg, 'a_color');
  const cubeMvpLoc = gl.getUniformLocation(cubeProg, 'u_mvp');

  const quadProg = compileProgram(quadVertSrc, quadFragSrc);
  const quadPosLoc = gl.getAttribLocation(quadProg, 'a_position');
  const quadUvLoc = gl.getAttribLocation(quadProg, 'a_uv');
  const quadTexLoc = gl.getUniformLocation(quadProg, 'u_texture');
  const quadTimeLoc = gl.getUniformLocation(quadProg, 'u_time');

  // ── cube geometry ────────────────────────────────────────────────────────

  const cubePosBuffer = uploadBuffer(cubePositions, gl.ARRAY_BUFFER);
  const cubeColBuffer = uploadBuffer(cubeColors, gl.ARRAY_BUFFER);
  const cubeIdxBuffer = uploadBuffer(cubeIndices, gl.ELEMENT_ARRAY_BUFFER);

  // ── quad geometry ────────────────────────────────────────────────────────

  const quadPosBuffer = uploadBuffer(quadPositions, gl.ARRAY_BUFFER);
  const quadUvBuffer = uploadBuffer(quadUVs, gl.ARRAY_BUFFER);

  // ── FBO: colour texture + depth renderbuffer ──────────────────────────────

  const FBO_SIZE = 256;

  // Colour attachment — a plain RGBA texture we will sample in pass 2
  const fboTexture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, fboTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, FBO_SIZE, FBO_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Depth attachment — a renderbuffer; we only need depth for the off-screen
  // pass and will never sample it, so a renderbuffer is the right tool.
  const depthRbo = gl.createRenderbuffer()!;
  gl.bindRenderbuffer(gl.RENDERBUFFER, depthRbo);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, FBO_SIZE, FBO_SIZE);

  // Assemble the FBO
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTexture, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRbo);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);

  // ── render loop ───────────────────────────────────────────────────────────

  let animId: number;

  function render(t: number) {
    const time = t * 0.001;

    // ── Pass 1: render cube into the FBO ────────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, FBO_SIZE, FBO_SIZE);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.06, 0.06, 0.14, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(cubeProg);

    const proj = mat4.perspective(mat4.create(), Math.PI / 3, 1, 0.1, 100);
    const view = mat4.lookAt(mat4.create(), [0, 1.5, 4], [0, 0, 0], [0, 1, 0]);
    const model = mat4.create();
    mat4.rotateY(model, model, time * 0.8);
    mat4.rotateX(model, model, time * 0.4);
    const mvp = mat4.multiply(mat4.create(), mat4.multiply(mat4.create(), proj, view), model);
    gl.uniformMatrix4fv(cubeMvpLoc, false, mvp);

    gl.bindBuffer(gl.ARRAY_BUFFER, cubePosBuffer);
    gl.enableVertexAttribArray(cubePosLoc);
    gl.vertexAttribPointer(cubePosLoc, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, cubeColBuffer);
    gl.enableVertexAttribArray(cubeColLoc);
    gl.vertexAttribPointer(cubeColLoc, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cubeIdxBuffer);
    gl.drawElements(gl.TRIANGLES, cubeIndices.length, gl.UNSIGNED_SHORT, 0);

    // ── Pass 2: display FBO texture on the canvas ───────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(quadProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fboTexture);
    gl.uniform1i(quadTexLoc, 0);
    gl.uniform1f(quadTimeLoc, time);

    gl.bindBuffer(gl.ARRAY_BUFFER, quadPosBuffer);
    gl.enableVertexAttribArray(quadPosLoc);
    gl.vertexAttribPointer(quadPosLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, quadUvBuffer);
    gl.enableVertexAttribArray(quadUvLoc);
    gl.vertexAttribPointer(quadUvLoc, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    animId = requestAnimationFrame(render);
  }

  animId = requestAnimationFrame(render);

  return () => cancelAnimationFrame(animId);
}
