import { alignmentOf, AnyWgslData, sizeOf } from 'typegpu/data';
import { $internal } from './types.ts';
import { ByeGLUniformLocation, UniformLocation } from './uniform.ts';
import { WgslGeneratorResult } from './wgsl/wgsl-generator.ts';
import { roundUp } from './math-utils.ts';

export class ByeGLShader implements WebGLShader {
  readonly [$internal]: {
    type: GLenum;
    source: string | null;
    destroyed: boolean;
  };

  constructor(type: GLenum) {
    this[$internal] = {
      type,
      source: null,
      destroyed: false,
    };
  }
}

class ByeGLProgramInternals {
  vert: ByeGLShader | undefined;
  frag: ByeGLShader | undefined;
  compiled: WgslGeneratorResult | undefined;
  uniformLocationsMap: Map<string, ByeGLUniformLocation> | undefined;
  activeUniforms: ByeGLUniformLocation[] = [];
  infoLog: string = '';
  wgpuShaderModule: GPUShaderModule | undefined;

  constructor() {}

  populateUniform(uniform: UniformLocation, active = true) {
    let byteOffset = uniform.byteOffset;

    if (uniform.dataType.type === 'array') {
      if (uniform.dataType.elementCount === 0) {
        return;
      }

      const elementType = uniform.dataType.elementType as AnyWgslData;
      const elementSize = roundUp(
        sizeOf(elementType),
        alignmentOf(elementType),
      );

      for (let i = 0; i < uniform.dataType.elementCount; ++i) {
        const elementUniform: UniformLocation = {
          baseInfo: uniform.baseInfo,
          name: `${uniform.name}[${i}]`,
          size: 1,
          byteOffset,
          dataType: elementType,
        };
        this.populateUniform(elementUniform, active);
        // An alias, not part of the active uniforms
        this.populateUniform(
          { ...elementUniform, name: uniform.name },
          /* active */ false,
        );
        byteOffset += elementSize;
      }

      return;
    }

    if (uniform.dataType.type === 'struct') {
      const propTypes = uniform.dataType.propTypes as Record<
        string,
        AnyWgslData
      >;
      for (const [propKey, propType] of Object.entries(propTypes)) {
        // Aligning to the start of the prop
        byteOffset = roundUp(byteOffset, alignmentOf(propType));

        this.populateUniform(
          {
            baseInfo: uniform.baseInfo,
            name: `${uniform.name}.${propKey}`,
            size: 1,
            byteOffset,
            dataType: propType,
          },
          active,
        );

        byteOffset += sizeOf(propType);
      }
      byteOffset = roundUp(byteOffset, alignmentOf(uniform.dataType));

      return;
    }

    const location = new ByeGLUniformLocation(uniform);
    this.uniformLocationsMap!.set(uniform.name, location);

    if (active) {
      this.activeUniforms.push(location);
    }
  }
}

export class ByeGLProgram implements WebGLProgram {
  readonly [$internal]: ByeGLProgramInternals;

  constructor() {
    this[$internal] = new ByeGLProgramInternals();
  }
}
