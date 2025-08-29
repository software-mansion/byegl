const gl = WebGL2RenderingContext;

export const primitiveMap = {
  [gl.POINTS]: 'point-list',
  [gl.LINES]: 'line-list',
  [gl.LINE_STRIP]: 'line-strip',
  [gl.LINE_LOOP]: undefined, // TODO: Support line loops
  [gl.TRIANGLES]: 'triangle-list',
  [gl.TRIANGLE_STRIP]: 'triangle-strip',
  [gl.TRIANGLE_FAN]: undefined, // TODO: Support triangle fans
} as const;
