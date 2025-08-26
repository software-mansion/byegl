export interface WgslGeneratorResult {
  wgsl: string;

  /**
   * A mapping of name to numeric index for vertex attributes.
   * Valid for definitions using the `attribute` qualifier.
   * @example
   * ```ts
   * // attribute vec2f a_position;
   * result.attributeLocationMap.get('a_position') // 0
   * ```
   */
  attributeLocationMap: Map<string, number>;

  /**
   * A mapping of name to numeric index for uniforms.
   * Valid for definitions using the `uniform` qualifier.
   * @example
   * ```ts
   * // uniform mat4 u_worldMat;
   * result.uniformLocationMap.get('u_worldMat') // 0
   * ```
   */
  uniformLocationMap: Map<string, number>;
}

export interface WgslGenerator {
  generate(vertexCode: string, fragmentCode: string): WgslGeneratorResult;
}
