import {
  type AnyWgslData,
  alignmentOf,
  isDecorated,
  sizeOf,
} from 'typegpu/data';
import { isPrimitive } from './data-types.ts';
import { roundUp } from './math-utils.ts';
import { $internal } from './types.ts';
import { ByeGLUniformLocation, UniformLocation } from './uniform.ts';
import { AttributeInfo, WgslGeneratorResult } from './wgsl/wgsl-generator.ts';

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
  activeAttribs: AttributeInfo[] = [];
  infoLog: string = '';
  wgpuShaderModule: GPUShaderModule | undefined;

  constructor() {}

  populateUniform(uniform: UniformLocation, active = true): void {
    let byteOffset = uniform.byteOffset;
    let dataType = uniform.dataType;
    if (isDecorated(dataType)) {
      dataType = dataType.inner;
    }

    if (dataType.type === 'array') {
      const elementCount = dataType.elementCount;
      if (elementCount === 0) {
        return;
      }

      const elementType = dataType.elementType as AnyWgslData;
      const elementSize = roundUp(
        sizeOf(elementType),
        alignmentOf(elementType),
      );

      for (let i = 0; i < elementCount; ++i) {
        const elementUniform: UniformLocation = {
          baseInfo: uniform.baseInfo,
          name: `${uniform.name}[${i}]`,
          size: 1,
          byteOffset,
          dataType: elementType,
        };

        if (isPrimitive(elementType)) {
          this.populateUniform(
            { ...elementUniform, size: elementCount },
            active && i === 0,
          );

          if (i === 0) {
            // An alias, not part of the active uniforms
            this.populateUniform(
              { ...elementUniform, name: uniform.name, size: elementCount },
              /* active */ false,
            );
          }
        } else {
          this.populateUniform(elementUniform, active);
        }

        byteOffset += elementSize;
      }

      return;
    }

    if (dataType.type === 'struct') {
      const propTypes = dataType.propTypes as Record<string, AnyWgslData>;
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
      byteOffset = roundUp(byteOffset, alignmentOf(dataType));

      return;
    }

    const location = new ByeGLUniformLocation({
      ...uniform,
      dataType,
    });
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
