import * as degl from 'degl';

function createWaterSurface(
  device: GPUDevice,
  resolution: readonly [number, number],
) {
  const vertexBuffer = device.createBuffer({
    size: resolution[0] * resolution[1] * 6 * 16, // float32x3 (with 4 byte padding)
    usage:
      GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const timeBuffer = device.createBuffer({
    size: 4, // float32
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const shaderCode = /* wgsl */ `
    @group(0) @binding(0) var<storage, read_write> vertices: array<vec3f>;
    @group(0) @binding(1) var<uniform> time: f32;

    @compute @workgroup_size(1)
    fn main(@builtin(global_invocation_id) gid: vec3u) {
      let idx = gid.x + gid.y * ${resolution[0]};
      let x = f32(gid.x);
      let z = f32(gid.y);

      let start = idx * 6;
      let height = sin(time + f32(idx) * 0.01) * 10;

      vertices[start + 0] = vec3f(x, height, z);
      vertices[start + 1] = vec3f(x + 1, height, z);
      vertices[start + 2] = vec3f(x + 1, height, z + 1);

      vertices[start + 3] = vec3f(x, height, z);
      vertices[start + 4] = vec3f(x + 1, height, z + 1);
      vertices[start + 5] = vec3f(x, height, z + 1);
    }
  `;

  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: shaderCode }),
    },
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: vertexBuffer } },
      { binding: 1, resource: { buffer: timeBuffer } },
    ],
  });

  return {
    vertexBuffer,
    computeGeometry() {
      device.queue.writeBuffer(
        timeBuffer,
        0,
        new Float32Array([performance.now() / 1000]),
      );
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(resolution[0], resolution[1]);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
  };
}

export default function (canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl')!;

  if (!gl) {
    throw new Error('WebGL not supported');
  }

  const vertexShaderSource = `
    attribute vec4 a_position;

    void main() {
      gl_Position = vec4(a_position.xyz * 0.1, 1.0);
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;
    void main() {
      gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
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

  const resolution = [32, 32] as const;
  const waterSurface = createWaterSurface(degl.getDevice(gl), resolution);
  waterSurface.computeGeometry();
  const positionBuffer = degl.importWebGPUBuffer(gl, waterSurface.vertexBuffer);

  const positionLocation = gl.getAttribLocation(program, 'a_position');
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 4, gl.FLOAT, false, 0, 0);

  function animate() {
    handle = requestAnimationFrame(animate);
    waterSurface.computeGeometry();

    gl.useProgram(program);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, resolution[0] * resolution[1] * 6);
  }

  let handle = requestAnimationFrame(animate);

  return () => {
    cancelAnimationFrame(handle);
  };
}
