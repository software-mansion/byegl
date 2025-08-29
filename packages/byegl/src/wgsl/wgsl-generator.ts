import * as d from 'typegpu/data';

export interface AttributeInfo {
  /**
   * The name of the attribute in the global scope (the proxy)
   */
  id: string;
  // /**
  //  * The name of the attribute in the local scope (the param in the entry function)
  //  */
  // paramId: string;
  location: number;
  type: d.AnyWgslData;
}

export interface VaryingInfo {
  /**
   * The name of the varying in the global scope of the vertex shader and
   * the fragment shader (they have to match in order for WebGL to be able to link them)
   *
   * Will be used as the name of the proxy for use by the fragment entry function (and transitive dependencies)
   */
  id: string;
  // /**
  //  * The key in the Varying struct that holds the varying value
  //  */
  // propKey: string;
  location: number;
  type: d.AnyWgslData;
}

export interface UniformInfo {
  /**
   * The name of the uniform in the global scope
   */
  id: string;
  location: number;
  type: d.AnyWgslData;
}

export interface WgslGeneratorResult {
  wgsl: string;

  /**
   * A mapping of name to details about the attribute.
   * Valid for definitions using the `attribute` qualifier.
   * @example
   * ```ts
   * // attribute vec2f a_position;
   * result.attributes.get('a_position') // { id: 'a_position', location: 0, type: d.vec2f }
   * ```
   */
  attributes: Map<string, AttributeInfo>;

  /**
   * A mapping of name to details about the uniform.
   * Valid for definitions using the `uniform` qualifier.
   * @example
   * ```ts
   * // uniform mat4 u_worldMat;
   * result.uniforms.get('u_worldMat') // { id: 'u_worldMat', location: 0, type: d.mat4f }
   * ```
   */
  uniforms: Map<string, UniformInfo>;
}

export interface WgslGenerator {
  generate(vertexCode: string, fragmentCode: string): WgslGeneratorResult;
}
