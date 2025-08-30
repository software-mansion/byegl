import { mat4 } from 'gl-matrix';
import { loadTexture } from '../../_common/loadTexture.ts';
import type { ExampleContext } from '../../types.ts';
import dungeonSheetUrl from './dungeon_sheet.png';

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
    gl_FragColor = texture2D(u_texture, v_uv);
  }
`;

class TileMap {
  texture: WebGLTexture | undefined;
  width: number = 0;
  height: number = 0;

  readonly loaded: Promise<void>;

  constructor(
    gl: WebGL2RenderingContext,
    public readonly tileSizeX: number,
    public readonly tileSizeY: number,
    src: string,
  ) {
    this.loaded = loadTexture(gl, src).then((texture) => {
      this.texture = texture.texture;
      this.width = texture.width;
      this.height = texture.height;
    });
  }
}

class TileGrid {
  #gl: WebGL2RenderingContext;
  #indexBuffer: WebGLBuffer;
  #positionBuffer: WebGLBuffer;
  #uvBuffer: WebGLBuffer;

  #program: WebGLProgram;
  #positionLocation: number;
  #uvLocation: number;
  #mvpMatrixLocation: WebGLUniformLocation;
  width: number = 0;
  height: number = 0;

  constructor(
    gl: WebGL2RenderingContext,
    public readonly tileMap: TileMap,
  ) {
    this.#gl = gl;
    this.#indexBuffer = gl.createBuffer();
    this.#positionBuffer = gl.createBuffer();
    this.#uvBuffer = gl.createBuffer();

    const vertexShader = gl.createShader(gl.VERTEX_SHADER) as WebGLShader;
    gl.shaderSource(vertexShader, vertexShaderSource);
    gl.compileShader(vertexShader);

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER) as WebGLShader;
    gl.shaderSource(fragmentShader, fragmentShaderSource);
    gl.compileShader(fragmentShader);

    this.#program = gl.createProgram();
    gl.attachShader(this.#program, vertexShader);
    gl.attachShader(this.#program, fragmentShader);
    gl.linkProgram(this.#program);
    gl.useProgram(this.#program);

    this.#positionLocation = gl.getAttribLocation(this.#program, 'a_position');
    this.#uvLocation = gl.getAttribLocation(this.#program, 'a_uv');
    this.#mvpMatrixLocation = gl.getUniformLocation(
      this.#program,
      'u_mvpMatrix',
    )!;

    gl.bindTexture(gl.TEXTURE_2D, tileMap.texture!);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  set(data: number[][]) {
    const gl = this.#gl;
    const width = data[0].length;
    const height = data.length;
    this.width = width;
    this.height = height;

    // Four vertices per tile (2 floats per vertex)
    const posData = new Float32Array(width * height * 4 * 2);
    const uvData = new Float32Array(width * height * 4 * 2);
    const indexData = new Uint16Array(width * height * 6);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4 * 2;

        posData[i] = x;
        posData[i + 1] = height - y - 1;

        posData[i + 2] = x + 1;
        posData[i + 3] = height - y - 1;

        posData[i + 4] = x;
        posData[i + 5] = height - y;

        posData[i + 6] = x + 1;
        posData[i + 7] = height - y;
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.#positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, posData, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4 * 2;
        const dx = this.tileMap.tileSizeX / this.tileMap.width;
        const dy = this.tileMap.tileSizeY / this.tileMap.height;
        const sx = (data[y][x] * dx) % 1;
        const sy = Math.floor(data[y][x] * dx) * dy;

        uvData[i] = sx + 0;
        uvData[i + 1] = sy + dy;

        uvData[i + 2] = sx + dx;
        uvData[i + 3] = sy + dy;

        uvData[i + 4] = sx + 0;
        uvData[i + 5] = sy + 0;

        uvData[i + 6] = sx + dx;
        uvData[i + 7] = sy + 0;
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.#uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, uvData, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 6;
        const i = (y * width + x) * 4;

        indexData[idx] = i;
        indexData[idx + 1] = i + 1;
        indexData[idx + 2] = i + 2;
        indexData[idx + 3] = i + 1;
        indexData[idx + 4] = i + 3;
        indexData[idx + 5] = i + 2;
      }
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexData, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  }

  draw(mvpMatrix: mat4) {
    const gl = this.#gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#positionBuffer);
    gl.enableVertexAttribArray(this.#positionLocation);
    gl.vertexAttribPointer(this.#positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.#uvBuffer);
    gl.enableVertexAttribArray(this.#uvLocation);
    gl.vertexAttribPointer(this.#uvLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#indexBuffer);

    // gl.enable(gl.CULL_FACE);
    gl.useProgram(this.#program);
    gl.uniformMatrix4fv(this.#mvpMatrixLocation, false, mvpMatrix);

    gl.drawElements(
      gl.TRIANGLES,
      this.width * this.height * 6,
      gl.UNSIGNED_SHORT,
      0,
    );
  }
}

export default async function ({ canvas }: ExampleContext) {
  const gl = canvas.getContext('webgl2')!;

  if (!gl) {
    throw new Error('WebGL not supported');
  }

  // Create and initialize tilemap
  const tileMap = new TileMap(gl, 16, 16, dungeonSheetUrl.src);
  await tileMap.loaded; // Waiting for the texture to load
  const bgTileGrid = new TileGrid(gl, tileMap);
  const tileGrid = new TileGrid(gl, tileMap);

  bgTileGrid.set([
    [54, 54, 54, 54, 54, 54, 54, 54],
    [54, 54, 54, 54, 54, 54, 54, 54],
    [54, 54, 54, 54, 54, 54, 54, 54],
    [54, 54, 54, 54, 54, 54, 54, 54],
    [54, 54, 54, 54, 54, 54, 54, 54],
    [54, 54, 54, 54, 54, 54, 54, 54],
    [54, 54, 54, 54, 54, 54, 54, 54],
    [54, 54, 54, 54, 54, 54, 54, 54],
  ]);

  tileGrid.set([
    [5, 6, 6, 6, 6, 6, 6, 7],
    [29, 30, 30, 30, 30, 30, 30, 31],
    [53, 54, 54, 54, 54, 207, 208, 55],
    [53, 54, 54, 54, 54, 231, 232, 55],
    [53, 54, 54, 54, 54, 54, 54, 55],
    [53, 54, 54, 54, 54, 54, 54, 55],
    [53, 54, 54, 54, 54, 54, 54, 55],
    [77, 78, 78, 78, 78, 78, 78, 79],
  ]);

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
    mat4.translate(modelMatrix, modelMatrix, [-2, -2, -6]);
    mat4.multiply(mvpMatrix, projectionMatrix, modelMatrix);

    // #2f283a
    gl.clearColor(0.18, 0.16, 0.22, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);

    bgTileGrid.draw(mvpMatrix);
    tileGrid.draw(mvpMatrix);
  }

  let handle = requestAnimationFrame(animate);

  return () => {
    cancelAnimationFrame(handle);
  };
}
