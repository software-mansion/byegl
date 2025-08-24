import * as shaderkit from '@iwoplaza/shaderkit';
import { WgslGenerator, WgslGeneratorResult } from './wgsl-generator.ts';

interface AttributeInfo {
  /**
   * The name of the attribute in the global scope (the proxy)
   */
  id: string;
  /**
   * The name of the attribute in the local scope (the param in the entry function)
   */
  paramId: string;
  location: number;
  type: string;
}

interface VaryingInfo {
  /**
   * The name of the varying in the global scope of the vertex shader and
   * the fragment shader (they have to match in order for WebGL to be able to link them)
   *
   * Will be used as the name of the proxy for use by the fragment entry function (and transitive dependencies)
   */
  id: string;
  /**
   * The key in the Varying struct that holds the varying value
   */
  propKey: string;
  location: number;
  type: string;
}

interface UniformInfo {
  /**
   * The name of the uniform in the global scope
   */
  id: string;
  bindingIdx: number;
  type: string;
}

const glslToWgslTypeMap = {
  vec2: 'vec2f',
  vec3: 'vec3f',
  vec4: 'vec4f',
  ivec2: 'vec2i',
  ivec3: 'vec3i',
  ivec4: 'vec4i',
  uvec2: 'vec2u',
  uvec3: 'vec3u',
  uvec4: 'vec4u',
  mat2: 'mat2x2f',
  mat3: 'mat3x3f',
  mat4: 'mat4x4f',
};

export class ShaderkitWGSLGenerator implements WgslGenerator {
  /**
   * NOTE: Always assuming 0, but it may be wise to make this customizable
   */
  #bindingGroupIdx = 0;

  #shaderType: 'vertex' | 'fragment' =
    'vertex' /* does not matter, will get overriden */;

  /** Used to track variable declarations with the `attribute` qualifier */
  #lastAttributeIdx = -1;
  #attributes = new Map<number, AttributeInfo>();
  /** Used to track variable declarations with the `varying` qualifier */
  #lastVaryingIdx = -1;
  #varyings = new Map<number, VaryingInfo>();
  /** Used to track variable declarations with the `uniform` qualifier */
  #lastBindingIdx = -1;
  #uniforms = new Map<number, UniformInfo>();

  #lastUniqueIdSuffix = -1;

  uniqueId(primer?: string | undefined): string {
    return `${primer ?? 'item'}_${++this.#lastUniqueIdSuffix}`;
  }

  #fakeVertexMainId = this.uniqueId('fake_vertex');
  #fakeFragmentMainId = this.uniqueId('fake_fragment');

  generateTypeSpecifier(
    typeSpecifier: shaderkit.Identifier | shaderkit.ArraySpecifier,
  ): string {
    if (typeSpecifier.type === 'Identifier') {
      if (typeSpecifier.name in glslToWgslTypeMap) {
        return glslToWgslTypeMap[
          typeSpecifier.name as keyof typeof glslToWgslTypeMap
        ];
      }
      return typeSpecifier.name;
    }

    throw new Error(`Unsupported type specifier: ${typeSpecifier.type}`);
  }

  generateExpression(expression: shaderkit.Expression): string {
    if (expression.type === 'Identifier') {
      return expression.name;
    }

    if (expression.type === 'Literal') {
      return expression.value;
    }

    if (expression.type === 'CallExpression') {
      if (expression.callee.type !== 'Identifier') {
        throw new Error(`Unsupported callee type: ${expression.callee.type}`);
      }
      const funcName = expression.callee.name;
      const args = expression.arguments
        .map((arg) => this.generateExpression(arg))
        .join(', ');
      return `${funcName}(${args});`;
    }

    if (expression.type === 'AssignmentExpression') {
      if (expression.left.type !== 'Identifier') {
        throw new Error(`Unsupported left type: ${expression.left.type}`);
      }
      const left = expression.left.name;
      const right = this.generateExpression(expression.right);
      return `${left} = ${right};`;
    }

    if (expression.type === 'BinaryExpression') {
      const left = this.generateExpression(expression.left);
      const right = this.generateExpression(expression.right);
      return `${left} ${expression.operator} ${right}`;
    }

    if (expression.type === 'UnaryExpression') {
      const argument = this.generateExpression(expression.argument);
      return `${expression.operator}${argument}`;
    }

    throw new Error(`Unsupported expression type: ${expression.type}`);
  }

  generateStatement(statement: shaderkit.Statement): string {
    if (statement.type === 'VariableDeclaration') {
      let code = '';

      for (const decl of statement.declarations) {
        if (decl.qualifiers.includes('attribute')) {
          // Finding the next available attribute index
          do {
            this.#lastAttributeIdx++;
          } while (this.#attributes.has(this.#lastAttributeIdx));

          const wgslType = this.generateTypeSpecifier(decl.typeSpecifier);

          this.#attributes.set(this.#lastAttributeIdx, {
            id: decl.id.name,
            paramId: this.uniqueId(decl.id.name),
            location: this.#lastAttributeIdx,
            type: wgslType,
          });

          // Defining proxies
          code += `/* attribute */ var<private> ${decl.id.name}: ${wgslType};\n`;
        }

        if (decl.qualifiers.includes('varying')) {
          // Finding the next available varying index
          do {
            this.#lastVaryingIdx++;
          } while (this.#varyings.has(this.#lastVaryingIdx));

          if (this.#shaderType === 'vertex') {
            // Only generating in the vertex shader
            const wgslType = this.generateTypeSpecifier(decl.typeSpecifier);

            this.#varyings.set(this.#lastVaryingIdx, {
              id: decl.id.name,
              // Arbitrary, choosing the vertex name to be the prop key
              propKey: decl.id.name,
              location: this.#lastVaryingIdx,
              type: wgslType,
            });

            // Defining proxies
            code += `/* varying */ var<private> ${decl.id.name}: ${wgslType};\n`;
          }
        }

        if (decl.qualifiers.includes('uniform')) {
          // Finding the next available uniform index
          do {
            this.#lastBindingIdx++;
          } while (this.#uniforms.has(this.#lastBindingIdx));

          const wgslType = this.generateTypeSpecifier(decl.typeSpecifier);

          this.#uniforms.set(this.#lastBindingIdx, {
            id: decl.id.name,
            bindingIdx: this.#lastBindingIdx,
            type: this.generateTypeSpecifier(decl.typeSpecifier),
          });

          code += `@group(${this.#bindingGroupIdx}) @binding(${this.#lastBindingIdx}) var<uniform> ${decl.id.name}: ${wgslType};\n`;
        }

        // TODO: Handle manual layout qualifiers (e.g. layout(location=0))
      }
      return code;
    }

    if (statement.type === 'FunctionDeclaration') {
      let funcName = statement.id.name;
      let params = statement.params.map((param) => param.id?.name).join(', ');

      if (funcName === 'main') {
        // We're generating the entry function!
        // We approach it by generating a "fake" entry function
        // that gets called by the actual entry function.
        funcName =
          this.#shaderType === 'vertex'
            ? this.#fakeVertexMainId
            : this.#fakeFragmentMainId;
      }

      const body = statement.body?.body
        .map((stmt) => this.generateStatement(stmt))
        .join('\n');

      return `\nfn ${funcName}(${params}) {\n${body}\n}\n`;
    }

    if (statement.type === 'ExpressionStatement') {
      return this.generateExpression(statement.expression);
    }

    if (statement.type === 'PrecisionQualifierStatement') {
      // No-op
      return '';
    }

    throw new Error(`Cannot generate ${statement.type} statements yet.`);
  }

  generate(vertexCode: string, fragmentCode: string): WgslGeneratorResult {
    // Initializing
    this.#lastAttributeIdx = -1;
    this.#lastBindingIdx = -1;

    const vertexAst = shaderkit.parse(vertexCode);
    const fragmentAst = shaderkit.parse(fragmentCode);

    let wgsl = `// Generated by degl

var<private> gl_Position: vec4<f32>;
var<private> gl_FragColor: vec4<f32>;

`;

    this.#lastVaryingIdx = -1;
    this.#shaderType = 'vertex';
    for (const statement of vertexAst.body) {
      wgsl += this.generateStatement(statement);
    }

    this.#lastVaryingIdx = -1;
    this.#shaderType = 'fragment';
    for (const statement of fragmentAst.body) {
      wgsl += this.generateStatement(statement);
    }

    // Generating the real entry functions
    const attribParams = [...this.#attributes.values()]
      .map(
        (attribute) =>
          `@location(${attribute.location}) ${attribute.paramId}: ${attribute.type}`,
      )
      .join(', ');

    // Vertex output struct
    const vertOutStructId = this.uniqueId('VertexOut');
    const posOutParamId = this.uniqueId('posOut');
    wgsl += `
struct ${vertOutStructId} {
  @builtin(position) ${posOutParamId}: vec4f,
${[...this.#varyings.values()].map((varying) => `  @location(${varying.location}) ${varying.id}: ${varying.type},`).join('\n')}
}

`;

    // Fragment input struct
    let fragInStructId: string | undefined;
    if (this.#varyings.size > 0) {
      fragInStructId = this.uniqueId('FragmentIn');
      const fragInParams = [...this.#varyings.values()]
        .map(
          (varying) =>
            `  @location(${varying.location}) ${varying.id}: ${varying.type},`,
        )
        .join('\n');
      wgsl += `
struct ${fragInStructId} {
${fragInParams}
}

`;
    }

    wgsl += `
@vertex
fn ${this.uniqueId('vert_main')}(${attribParams}) -> ${vertOutStructId} {
${[...this.#attributes.values()].map((attribute) => `  ${attribute.id} = ${attribute.paramId};\n`).join('')}

  ${this.#fakeVertexMainId}();
  var output: ${vertOutStructId};
  output.${posOutParamId} = gl_Position;
${[...this.#varyings.values()].map((varying) => `  output.${varying.id} = ${varying.id};\n`).join('')}
  return output;
}

@fragment
fn ${this.uniqueId('frag_main')}(${fragInStructId ? `input: ${fragInStructId}` : ''}) -> @location(0) vec4f {
  // Filling proxies with varying data
${[...this.#varyings.values()].map((varying) => `  ${varying.id} = input.${varying.id};\n`).join('')}
  ${this.#fakeFragmentMainId}();
  return gl_FragColor;
}
`;

    console.log('Generated:\n', wgsl);

    return {
      wgsl,
      attributeLocationMap: new Map(
        [...this.#attributes.values()].map((info) => {
          return [info.id, info.location] as const;
        }),
      ),
      uniformLocationMap: new Map(
        [...this.#uniforms.values()].map((info) => {
          return [info.id, info.bindingIdx] as const;
        }),
      ),
    };
  }
}
