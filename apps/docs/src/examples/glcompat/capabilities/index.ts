import type { ExampleContext } from '../../types.ts';

export default function ({ canvas, trace }: ExampleContext) {
  const gl = canvas.getContext('webgl');

  if (!gl) {
    throw new Error('WebGL not supported');
  }

  for (const shaderType of ['VERTEX_SHADER', 'FRAGMENT_SHADER'] as const) {
    for (const precisionType of [
      'LOW_FLOAT',
      'MEDIUM_FLOAT',
      'HIGH_FLOAT',
      'LOW_INT',
      'MEDIUM_INT',
      'HIGH_INT',
    ] as const) {
      const format = gl.getShaderPrecisionFormat(
        gl[shaderType],
        gl[precisionType],
      );
      trace({
        call: `gl.getShaderPrecisionFormat(${shaderType}, ${precisionType})`,
        rangeMin: format?.rangeMin,
        rangeMax: format?.rangeMax,
        precision: format?.precision,
      });
    }
  }
}
