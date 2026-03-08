'use strict';

import type { ExampleContext } from '../../types.ts';

const vertexShaderSource = /* glsl */ `
  attribute vec2 a_position;
  varying vec2 v_uv;

  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_uv = a_position;
  }
`;

const fragmentShaderSource = /* glsl */ `
  precision highp float;

  varying vec2 v_uv;
  uniform float u_time;
  uniform vec2 u_resolution;

  #define MAX_STEPS 120
  #define MAX_DIST  30.0
  #define SURF_DIST 0.001
  #define PI        3.14159265359

  // ── Rotation helpers (no swizzle-mutation for byegl compat) ──────────────

  vec3 rotX(vec3 p, float a) {
    float c = cos(a), s = sin(a);
    return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
  }

  vec3 rotY(vec3 p, float a) {
    float c = cos(a), s = sin(a);
    return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
  }

  vec3 rotZ(vec3 p, float a) {
    float c = cos(a), s = sin(a);
    return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
  }

  // ── SDF Primitives ────────────────────────────────────────────────────────

  float sdSphere(vec3 p, float r) {
    return length(p) - r;
  }

  float sdBox(vec3 p, vec3 b) {
    vec3 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
  }

  float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
  }

  float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
    vec3 pa = p - a;
    vec3 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
  }

  float sdOctahedron(vec3 p, float s) {
    p = abs(p);
    return (p.x + p.y + p.z - s) * 0.57735027;
  }

  float sdCylinder(vec3 p, float h, float r) {
    vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  }

  // Smooth minimum (C1 continuous blending)
  float smin(float a, float b, float k) {
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * k * 0.25;
  }

  // Keep the result with smaller distance, carrying the material ID
  vec2 minRes(vec2 a, vec2 b) {
    return a.x < b.x ? a : b;
  }

  // ── Scene ─────────────────────────────────────────────────────────────────
  // Returns vec2(signed_distance, material_id)

  vec2 mapScene(vec3 p) {
    float t = u_time;

    // Ground plane                                        material 1
    vec2 res = vec2(p.y + 1.5, 1.0);

    // ── 8 bouncing spheres in a ring                    material 2 ──
    for (int i = 0; i < 8; i++) {
      float fi     = float(i);
      float angle  = fi * PI * 0.25;
      float phase  = fi * PI * 0.25;
      float yOff   = sin(t * 1.4 + phase) * 0.5;
      float radius = 0.38 + 0.08 * sin(t * 2.0 + phase);
      vec3  center = vec3(cos(angle) * 3.5, yOff, sin(angle) * 3.5);
      res = minRes(res, vec2(sdSphere(p - center, radius), 2.0));
    }

    // ── 4 tori orbiting the centre                      material 3 ──
    for (int i = 0; i < 4; i++) {
      float fi          = float(i);
      float orbitAngle  = fi * PI * 0.5 + t * 0.4;
      float yOff        = sin(t * 0.9 + fi) * 0.4;
      vec3  torusCenter = vec3(cos(orbitAngle) * 2.2, yOff, sin(orbitAngle) * 2.2);
      vec3  q           = rotY(p - torusCenter, orbitAngle + t * 0.6);
      q                 = rotX(q, t * 0.5 + fi * 0.8);
      res = minRes(res, vec2(sdTorus(q, vec2(0.5, 0.13)), 3.0));
    }

    // ── 4 rotating boxes on an inner ring               material 4 ──
    for (int i = 0; i < 4; i++) {
      float fi         = float(i);
      float orbitAngle = fi * PI * 0.5 + PI * 0.25 + t * 0.35;
      float yOff       = sin(t * 1.1 + fi * 1.5) * 0.6;
      vec3  boxCenter  = vec3(cos(orbitAngle) * 1.6, yOff, sin(orbitAngle) * 1.6);
      vec3  q          = rotY(p - boxCenter, t * 0.9 + fi);
      q                = rotX(q, t * 0.6 + fi * 0.5);
      res = minRes(res, vec2(sdBox(q, vec3(0.22)), 4.0));
    }

    // ── Central pulsing sphere                          material 5 ──
    {
      float pulse = 0.55 + 0.12 * sin(t * 2.5);
      res = minRes(res, vec2(sdSphere(p, pulse), 5.0));
    }

    // ── 3 octahedra orbiting the centre                 material 6 ──
    for (int i = 0; i < 3; i++) {
      float fi    = float(i);
      float angle = fi * PI * 0.667 + t * 1.6;
      float yOff  = sin(t * 2.3 + fi * 2.0) * 0.35;
      vec3  q     = rotY(rotX(p - vec3(cos(angle) * 1.3, yOff, sin(angle) * 1.3), t * 1.4), t * 2.1);
      res = minRes(res, vec2(sdOctahedron(q, 0.28), 6.0));
    }

    // ── 2 sweeping capsules                             material 7 ──
    {
      vec3 a = vec3(-2.0, -1.0 + sin(t * 0.9) * 0.5,  sin(t * 0.7) * 1.5);
      vec3 b = vec3(-2.0,  0.6 + cos(t * 1.2) * 0.4,  cos(t * 0.7) * 1.5);
      res = minRes(res, vec2(sdCapsule(p, a, b, 0.14), 7.0));
    }
    {
      vec3 a = vec3( 2.0, -1.0 + cos(t * 0.9) * 0.5, -sin(t * 0.7) * 1.5);
      vec3 b = vec3( 2.0,  0.6 + sin(t * 1.2) * 0.4, -cos(t * 0.7) * 1.5);
      res = minRes(res, vec2(sdCapsule(p, a, b, 0.14), 7.0));
    }

    // ── 2 spinning cylinders                            material 8 ──
    {
      vec3 q = rotZ(p - vec3(-2.8, -0.3 + sin(t * 0.8) * 0.3, 0.0), t * 1.1);
      res = minRes(res, vec2(sdCylinder(q, 0.7, 0.18), 8.0));
    }
    {
      vec3 q = rotZ(p - vec3( 2.8, -0.3 + cos(t * 0.8) * 0.3, 0.0), -t * 0.9);
      res = minRes(res, vec2(sdCylinder(q, 0.7, 0.18), 8.0));
    }

    // ── 2 smooth-blended sphere+box pairs               material 9 ──
    {
      float d1 = sdSphere(p - vec3(0.0,  0.3 + sin(t * 1.7      ) * 0.45,  2.8), 0.33);
      float d2 = sdBox(rotY(p - vec3(0.0, -0.3 + cos(t * 1.4      ) * 0.45,  2.8),  t * 0.8), vec3(0.22));
      res = minRes(res, vec2(smin(d1, d2, 0.38), 9.0));
    }
    {
      float d1 = sdSphere(p - vec3(0.0,  0.3 + sin(t * 1.7 + PI) * 0.45, -2.8), 0.33);
      float d2 = sdBox(rotY(p - vec3(0.0, -0.3 + cos(t * 1.4 + PI) * 0.45, -2.8), -t * 0.8), vec3(0.22));
      res = minRes(res, vec2(smin(d1, d2, 0.38), 9.0));
    }

    return res;
  }

  // ── Normal via central differences (6 scene evaluations) ─────────────────

  vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
      mapScene(p + e.xyy).x - mapScene(p - e.xyy).x,
      mapScene(p + e.yxy).x - mapScene(p - e.yxy).x,
      mapScene(p + e.yyx).x - mapScene(p - e.yyx).x
    ));
  }

  // ── Ambient occlusion (5 samples along the normal) ────────────────────────

  float calcAO(vec3 pos, vec3 nor) {
    float occ = 0.0;
    float sca = 1.0;
    for (int i = 0; i < 5; i++) {
      float h = 0.01 + 0.16 * float(i) / 4.0;
      float d = mapScene(pos + h * nor).x;
      occ += (h - d) * sca;
      sca *= 0.75;
    }
    return clamp(1.0 - 2.5 * occ, 0.0, 1.0);
  }

  // ── Soft shadow with improved penumbra estimate ───────────────────────────
  // Based on Inigo Quilez's technique

  float softShadow(vec3 ro, vec3 rd, float mint, float maxt, float k) {
    float res = 1.0;
    float t   = mint;
    float ph  = 1.0e10;
    for (int i = 0; i < 40; i++) {
      float h = mapScene(ro + rd * t).x;
      if (h < 0.0001) return 0.0;
      float y = h * h / (2.0 * ph);
      float d = sqrt(h * h - y * y);
      res = min(res, k * d / max(0.0, t - y));
      ph = h;
      t += h;
      if (t > maxt) break;
    }
    return clamp(res, 0.0, 1.0);
  }

  // ── Per-material base colour ──────────────────────────────────────────────

  vec3 getMaterialColor(float mat, vec3 pos) {
    if (mat < 1.5) {
      // Checkerboard ground
      float check = mod(floor(pos.x * 0.7) + floor(pos.z * 0.7), 2.0);
      return mix(vec3(0.85, 0.85, 0.88), vec3(0.22, 0.22, 0.28), check);
    }
    if (mat < 2.5) return vec3(0.95, 0.25, 0.20); // red   – outer spheres
    if (mat < 3.5) return vec3(0.20, 0.65, 0.95); // blue  – tori
    if (mat < 4.5) return vec3(0.25, 0.88, 0.30); // green – boxes
    if (mat < 5.5) return vec3(1.00, 0.82, 0.10); // gold  – centre sphere
    if (mat < 6.5) return vec3(0.85, 0.30, 0.90); // violet– octahedra
    if (mat < 7.5) return vec3(1.00, 0.55, 0.10); // orange– capsules
    if (mat < 8.5) return vec3(0.10, 0.88, 0.70); // teal  – cylinders
    return             vec3(0.97, 0.88, 0.78);     // cream – blended blobs
  }

  // ── Main ──────────────────────────────────────────────────────────────────

  void main() {
    vec2 uv = v_uv;
    uv.x *= u_resolution.x / u_resolution.y;

    // Static camera, slightly above and behind the scene
    vec3 ro     = vec3(0.0, 4.0, 9.0);
    vec3 target = vec3(0.0, 0.0, 0.0);
    vec3 fwd    = normalize(target - ro);
    vec3 right  = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up     = cross(right, fwd);
    vec3 rd     = normalize(fwd + uv.x * right * 0.75 + uv.y * up * 0.75);

    // ── Ray march ──
    float tHit = 0.02;
    float mat  = -1.0;
    for (int i = 0; i < MAX_STEPS; i++) {
      vec2 res = mapScene(ro + rd * tHit);
      if (res.x < SURF_DIST) {
        mat = res.y;
        break;
      }
      tHit += res.x;
      if (tHit > MAX_DIST) break;
    }

    // ── Shading ──
    vec3 col;

    if (mat > 0.0) {
      vec3 pos       = ro + rd * tHit;
      vec3 nor       = calcNormal(pos);
      vec3 baseColor = getMaterialColor(mat, pos);
      float ao       = calcAO(pos, nor);

      // Three directional lights
      vec3 l1 = normalize(vec3( 0.7,  1.2,  0.6));
      vec3 l2 = normalize(vec3(-0.9,  0.5, -0.4));
      vec3 l3 = normalize(vec3( 0.0,  0.4, -1.0));

      vec3 offsetPos = pos + nor * 0.002;

      float diff1 = max(dot(nor, l1), 0.0);
      float sha1  = diff1 > 0.0 ? softShadow(offsetPos, l1, 0.01, 18.0, 18.0) : 0.0;

      float diff2 = max(dot(nor, l2), 0.0);
      float sha2  = diff2 > 0.0 ? softShadow(offsetPos, l2, 0.01, 18.0, 12.0) : 0.0;

      float diff3 = max(dot(nor, l3), 0.0);
      float sha3  = diff3 > 0.0 ? softShadow(offsetPos, l3, 0.01, 18.0,  8.0) : 0.0;

      // Blinn-Phong specular from the main light
      vec3  viewDir = normalize(-rd);
      float spec1   = pow(max(dot(nor, normalize(l1 + viewDir)), 0.0), 48.0) * sha1;
      float spec2   = pow(max(dot(nor, normalize(l2 + viewDir)), 0.0), 24.0) * sha2;

      vec3 ambient = vec3(0.06, 0.08, 0.14) * ao;
      col  = ambient * baseColor;
      col += baseColor * diff1 * sha1 * vec3(1.00, 0.93, 0.80) * 1.1;
      col += baseColor * diff2 * sha2 * vec3(0.65, 0.78, 1.00) * 0.45;
      col += baseColor * diff3 * sha3 * vec3(0.88, 0.82, 1.00) * 0.25;
      col += vec3(spec1 * 0.5 + spec2 * 0.2);

      // Distance fog
      float fog = 1.0 - exp(-tHit * 0.045);
      col = mix(col, vec3(0.12, 0.15, 0.22), fog);

    } else {
      // Sky gradient
      float skyT = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
      col = mix(vec3(0.45, 0.55, 0.78), vec3(0.08, 0.12, 0.28), 1.0 - skyT);
      // Sun disc
      float sun = pow(max(dot(rd, normalize(vec3(0.7, 1.2, 0.6))), 0.0), 128.0);
      col += vec3(1.0, 0.95, 0.75) * sun * 1.5;
    }

    // Reinhard tone mapping + gamma correction
    col = col / (col + vec3(0.6));
    col = pow(col, vec3(1.0 / 2.2));

    gl_FragColor = vec4(col, 1.0);
  }
`;

export default function ({ canvas }: ExampleContext) {
  const gl = canvas.getContext('webgl')!;
  if (!gl) return;

  function compileShader(type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  const vert = compileShader(gl.VERTEX_SHADER, vertexShaderSource);
  const frag = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);

  const program = gl.createProgram()!;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
  }

  const posLoc = gl.getAttribLocation(program, 'a_position');
  const timeLoc = gl.getUniformLocation(program, 'u_time');
  const resLoc = gl.getUniformLocation(program, 'u_resolution');

  // Full-screen quad (triangle strip)
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );

  function render(timestamp: number) {
    handle = requestAnimationFrame(render);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.uniform1f(timeLoc, timestamp * 0.001);
    gl.uniform2f(resLoc, canvas.width, canvas.height);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  let handle = requestAnimationFrame(render);

  return () => cancelAnimationFrame(handle);
}
