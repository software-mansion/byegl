import type { ExampleContext } from '../../types.ts';

// === Pass 1: MRT — render animated plasma to two color attachments simultaneously ===

const mrtVertSrc = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = a_uv;
}`;

const mrtFragSrc = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform float u_time;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outGray;
void main() {
  float t = u_time * 0.001;
  vec2 p = v_uv * 6.28318;
  float r = 0.5 + 0.5 * sin(p.x + t);
  float g = 0.5 + 0.5 * sin(p.y + t * 1.3);
  float b = 0.5 + 0.5 * sin(p.x + p.y + t * 0.7);
  outColor = vec4(r, g, b, 1.0);
  float luma = dot(vec3(r, g, b), vec3(0.299, 0.587, 0.114));
  outGray = vec4(luma, luma, luma, 1.0);
}`;

// === Pass 2: Display both textures side-by-side on the canvas ===

const displayVertSrc = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = a_uv;
}`;

const displayFragSrc = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_colorTex;
uniform sampler2D u_grayTex;
out vec4 fragColor;
void main() {
  if (v_uv.x < 0.5) {
    fragColor = texture(u_colorTex, vec2(v_uv.x * 2.0, v_uv.y));
  } else {
    fragColor = texture(u_grayTex, vec2((v_uv.x - 0.5) * 2.0, v_uv.y));
  }
}`;

export default function ({ canvas }: ExampleContext) {
  const gl = canvas.getContext('webgl2')!;
  if (!gl) throw new Error('WebGL2 not supported');

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

  // === Compile programs ===
  const mrtProg = compileProgram(mrtVertSrc, mrtFragSrc);
  const displayProg = compileProgram(displayVertSrc, displayFragSrc);

  // === Quad geometry (fullscreen) ===
  const quadPositions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
  const quadUvs = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);

  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, quadPositions, gl.STATIC_DRAW);

  const uvBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, quadUvs, gl.STATIC_DRAW);

  // === Attribute locations ===
  const mrtPosLoc = gl.getAttribLocation(mrtProg, 'a_position');
  const mrtUvLoc = gl.getAttribLocation(mrtProg, 'a_uv');
  const mrtTimeLoc = gl.getUniformLocation(mrtProg, 'u_time');

  const displayPosLoc = gl.getAttribLocation(displayProg, 'a_position');
  const displayUvLoc = gl.getAttribLocation(displayProg, 'a_uv');
  const displayColorTexLoc = gl.getUniformLocation(displayProg, 'u_colorTex');
  const displayGrayTexLoc = gl.getUniformLocation(displayProg, 'u_grayTex');

  // === Create two FBO textures ===
  const FBO_SIZE = 256;

  function createFboTexture(): WebGLTexture {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      FBO_SIZE,
      FBO_SIZE,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  const colorTex = createFboTexture();
  const grayTex = createFboTexture();

  // === Create FBO with two color attachments ===
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, grayTex, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    console.error('Framebuffer incomplete:', status);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  function bindQuad(posLoc: number, uvLoc: number) {
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);
  }

  let handle: number;

  function animate(time: number) {
    handle = requestAnimationFrame(animate);

    // === Pass 1: Render MRT to FBO ===
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, FBO_SIZE, FBO_SIZE);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(mrtProg);
    gl.uniform1f(mrtTimeLoc, time);
    bindQuad(mrtPosLoc, mrtUvLoc);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // === Pass 2: Display both textures side-by-side on the canvas ===
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0.05, 0.05, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(displayProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTex);
    gl.uniform1i(displayColorTexLoc, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, grayTex);
    gl.uniform1i(displayGrayTexLoc, 1);

    bindQuad(displayPosLoc, displayUvLoc);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  handle = requestAnimationFrame(animate);
  return () => {
    cancelAnimationFrame(handle);
  };
}
