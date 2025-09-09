import * as d from 'typegpu/data';
import { ByeglData } from '../data-types.ts';

export interface AttributeInfo {
  /**
   * The name of the attribute in the global scope (the proxy)
   */
  id: string;
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
  location: number;
  type: d.AnyWgslData;
}

export interface UniformInfo {
  /**
   * The name of the uniform in the global scope
   */
  id: string;
  location: number;
  type: ByeglData;
}

export interface WgslGeneratorResult {
  wgsl: string;

  /**
   * A list of attributes.
   * Valid for definitions using the `attribute` qualifier.
   * @example
   * ```ts
   * // attribute vec2f a_position;
   * result.attributes[0] // { id: 'a_position', location: 0, type: d.vec2f }
   * ```
   */
  attributes: AttributeInfo[];

  /**
   * A list of uniforms.
   * Valid for definitions using the `uniform` qualifier.
   * @example
   * ```ts
   * // uniform mat4 u_worldMat;
   * result.uniforms[0] // { id: 'u_worldMat', location: 0, type: d.mat4f }
   * ```
   */
  uniforms: UniformInfo[];

  /**
   * Associates sampler bindings and texture bindings
   */
  samplerToTextureMap: Map<UniformInfo, UniformInfo>;
}

export interface WgslGenerator {
  generate(vertexCode: string, fragmentCode: string): WgslGeneratorResult;
}
