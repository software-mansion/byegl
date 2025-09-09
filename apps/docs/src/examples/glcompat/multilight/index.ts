import type { ExampleContext } from '../../types.ts';

export default function ({ canvas, trace }: ExampleContext) {
  const gl = canvas.getContext('webgl')!;

  if (!gl) {
    throw new Error('WebGL not supported');
  }

  const vertexShaderSource = `
    attribute vec2 a_position;
    attribute vec3 a_color;

    varying vec3 v_color;
    varying vec2 v_uv;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_color = a_color;
      v_uv = a_position.xy;
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;

    varying vec3 v_color;
    varying vec2 v_uv;

    struct Light {
      vec2 position;
      vec3 color;
    };

    uniform Light u_light[4];

    void main() {
      vec3 lightColor = vec3(0.0);
      for (int i = 0; i < 4; i++) {
        float dist = length(u_light[i].position - v_uv);
        float acc = pow(max(0.0, 1.0 - dist), 2.0);
        lightColor += acc * u_light[i].color;
      }
      gl_FragColor = vec4(lightColor * 0.8 + vec3(0.2), 1.0);
    }
  `;

  const vertexShader = gl.createShader(gl.VERTEX_SHADER) as WebGLShader;
  gl.shaderSource(vertexShader, vertexShaderSource);
  gl.compileShader(vertexShader);

  if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
    console.error(
      'Error compiling vertex shader:',
      gl.getShaderInfoLog(vertexShader),
    );
  }

  const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER) as WebGLShader;
  gl.shaderSource(fragmentShader, fragmentShaderSource);
  gl.compileShader(fragmentShader);

  if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
    console.error(
      'Error compiling fragment shader:',
      gl.getShaderInfoLog(fragmentShader),
    );
  }

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Error linking program:', gl.getProgramInfoLog(program));
  }

  console.log('Uniforms:');
  for (
    let i = 0;
    i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    i++
  ) {
    console.log(gl.getActiveUniform(program, i));
  }

  console.log('Attributes:');
  for (
    let i = 0;
    i < gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
    i++
  ) {
    console.log(gl.getActiveAttrib(program, i));
  }

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

  function animate(timestamp: number) {
    handle = requestAnimationFrame(animate);

    gl.useProgram(program);

    const colors = [
      [1, 0.2, 0.2],
      [0.2, 1, 0.2],
      [0.2, 0.2, 1],
      [1, 1, 1],
    ];
    for (let i = 0; i < 4; ++i) {
      gl.uniform2f(
        gl.getUniformLocation(program, `u_light[${i}].position`),
        Math.sin(timestamp * (0.002 + Math.sin(i) * 0.001) + i),
        Math.cos(timestamp * (0.001 + Math.sin(i) * 0.002) + i),
      );
      gl.uniform3fv(
        gl.getUniformLocation(program, `u_light[${i}].color`),
        colors[i],
      );
    }

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  let handle = requestAnimationFrame(animate);

  return () => {
    cancelAnimationFrame(handle);
  };
}
