import type { ExampleContext } from '../../types.ts';

export default function ({ canvas }: ExampleContext) {
  const gl = canvas.getContext('webgl')!;

  if (!gl) {
    throw new Error('WebGL not supported');
  }

  const vertexShaderSource = /* glsl */ `
    attribute vec2 a_position;

    varying vec2 v_texCoord;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_position * 0.5 + 0.5;
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;

    varying vec2 v_texCoord;
    uniform float u_time;

    float sd_circle(vec2 p, float r) {
      return length(p) - r;
    }

    float smooth_min(float a, float b, float k) {
      float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
      return mix(b, a, h) - k * h * (1.0 - h);
    }

    struct Shape {
      float dist;
      vec3 color;
    };

    Shape smoothShapeUnion(Shape a, Shape b, float k) {
      float h = max(k - abs(a.dist - b.dist), 0.0) / k;
      float m = h * h;

      // Smooth min for distance
      float dist = min(a.dist, b.dist) - m * k * (1.0 / 4.0);

      // Blend colors based on relative distances and smoothing
      float weight = m + mix(0.0, 1.0 - m, a.dist > b.dist ? 1.0 : 0.0);
      vec3 color = mix(a.color, b.color, weight);

      Shape shape;
      shape.dist = dist;
      shape.color = color;
      return shape;
    }

    void main() {
      vec3 aColor = vec3(1.0, 0.3, 0.5);
      vec3 bColor = vec3(0.4, 0.5, 1.0);
      float d1 = sd_circle(v_texCoord - vec2(0.3 + sin(u_time * 3.0) * 0.1, 0.5), 0.2);
      float d2 = sd_circle(v_texCoord - vec2(0.7 - sin(u_time * 3.0) * 0.1, 0.5), 0.2);
      float d = smooth_min(d1, d2, 0.1);

      Shape aShape = Shape(d1, aColor);
      Shape bShape = Shape(d2, bColor);
      Shape shape = smoothShapeUnion(aShape, bShape, 0.1);

      float wave = sign(sin(shape.dist * 200.0)) * 0.25 + 0.75;
      vec3 posColor = vec3(0.2);
      vec3 negColor = vec3(0.3, 0.5, 1.0);
      if (shape.dist < 0.0) {
        gl_FragColor = vec4(shape.color * wave, 1.0);
      } else {
        gl_FragColor = vec4(posColor * wave, 1.0);
      }
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

  // Print shader info
  console.log('Vertex Shader Info:');
  console.log(gl.getShaderInfoLog(vertexShader));
  console.log('Fragment Shader Info:');
  console.log(gl.getShaderInfoLog(fragmentShader));
  console.log('Program Info:');
  console.log(gl.getProgramInfoLog(program));

  const timeLocation = gl.getUniformLocation(program, 'u_time');
  const positionLocation = gl.getAttribLocation(program, 'a_position');
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

  function animate(timestamp: number) {
    handle = requestAnimationFrame(animate);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(program);

    gl.uniform1f(timeLocation, timestamp / 1000);

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  let handle = requestAnimationFrame(animate);

  return () => {
    cancelAnimationFrame(handle);
  };
}
