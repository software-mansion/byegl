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
  float: 'f32',
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

interface GenState {
  shaderType: 'vertex' | 'fragment';

  attributes: Map<number, AttributeInfo>;
  varyings: Map<number, VaryingInfo>;
  uniforms: Map<number, UniformInfo>;

  /** Used to track variable declarations with the `attribute` qualifier */
  lastAttributeIdx: number;
  /** Used to track variable declarations with the `varying` qualifier */
  lastVaryingIdx: number;
  /** Used to track variable declarations with the `uniform` qualifier */
  lastBindingIdx: number;

  fakeVertexMainId: string;
  fakeFragmentMainId: string;

  lineStart: string;
  definingFunction: boolean;
}

export class ShaderkitWGSLGenerator implements WgslGenerator {
  /**
   * NOTE: Always assuming 0, but it may be wise to make this customizable
   */
  #bindingGroupIdx = 0;
  #state!: GenState;

  #lastUniqueIdSuffix = -1;

  uniqueId(primer?: string | undefined): string {
    return `${primer ?? 'item'}_${++this.#lastUniqueIdSuffix}`;
  }

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

      if (funcName in glslToWgslTypeMap) {
        const type =
          glslToWgslTypeMap[funcName as keyof typeof glslToWgslTypeMap];
        return `${type}(${args})`;
      }

      return `${funcName}(${args})`;
    }

    if (expression.type === 'AssignmentExpression') {
      if (expression.left.type !== 'Identifier') {
        throw new Error(`Unsupported left type: ${expression.left.type}`);
      }
      const left = expression.left.name;
      const right = this.generateExpression(expression.right);
      return `${left} = ${right}`;
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

    if (expression.type === 'MemberExpression') {
      const object = this.generateExpression(expression.object);
      const property = this.generateExpression(expression.property);
      return `${object}.${property}`;
    }

    throw new Error(`Unsupported expression type: ${expression.type}`);
  }

  generateStatement(statement: shaderkit.Statement): string {
    const state = this.#state;
    if (statement.type === 'VariableDeclaration') {
      let code = '';

      for (const decl of statement.declarations) {
        if (decl.qualifiers.includes('attribute')) {
          // Finding the next available attribute index
          do {
            state.lastAttributeIdx++;
          } while (state.attributes.has(state.lastAttributeIdx));

          const wgslType = this.generateTypeSpecifier(decl.typeSpecifier);

          state.attributes.set(state.lastAttributeIdx, {
            id: decl.id.name,
            paramId: this.uniqueId(decl.id.name),
            location: state.lastAttributeIdx,
            type: wgslType,
          });

          // Defining proxies
          code += `/* attribute */ var<private> ${decl.id.name}: ${wgslType};\n`;
        } else if (decl.qualifiers.includes('varying')) {
          // Finding the next available varying index
          do {
            state.lastVaryingIdx++;
          } while (state.varyings.has(state.lastVaryingIdx));

          if (state.shaderType === 'vertex') {
            // Only generating in the vertex shader
            const wgslType = this.generateTypeSpecifier(decl.typeSpecifier);

            state.varyings.set(state.lastVaryingIdx, {
              id: decl.id.name,
              // Arbitrary, choosing the vertex name to be the prop key
              propKey: decl.id.name,
              location: state.lastVaryingIdx,
              type: wgslType,
            });

            // Defining proxies
            code += `/* varying */ var<private> ${decl.id.name}: ${wgslType};\n`;
          }
        } else if (decl.qualifiers.includes('uniform')) {
          // Finding the next available uniform index
          do {
            state.lastBindingIdx++;
          } while (state.uniforms.has(state.lastBindingIdx));

          const wgslType = this.generateTypeSpecifier(decl.typeSpecifier);

          state.uniforms.set(state.lastBindingIdx, {
            id: decl.id.name,
            bindingIdx: state.lastBindingIdx,
            type: this.generateTypeSpecifier(decl.typeSpecifier),
          });

          code += `@group(${this.#bindingGroupIdx}) @binding(${state.lastBindingIdx}) var<uniform> ${decl.id.name}: ${wgslType};\n`;
        } else {
          // Regular variable
          const wgslType = this.generateTypeSpecifier(decl.typeSpecifier);
          if (decl.init) {
            code += `${state.lineStart}var${state.definingFunction ? '' : '<private>'} ${decl.id.name}: ${wgslType} = ${this.generateExpression(decl.init)};\n`;
          } else {
            code += `${state.lineStart}var${state.definingFunction ? '' : '<private>'} ${decl.id.name}: ${wgslType};\n`;
          }
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
          state.shaderType === 'vertex'
            ? state.fakeVertexMainId
            : state.fakeFragmentMainId;
      }

      let prevDefiningFunction = state.definingFunction;
      let prevLineStart = state.lineStart;
      try {
        state.definingFunction = true;
        state.lineStart += '  ';
        const body = statement.body?.body
          .map((stmt) => this.generateStatement(stmt))
          .join('');

        return `\nfn ${funcName}(${params}) {\n${body}\n}\n`;
      } finally {
        state.definingFunction = prevDefiningFunction;
        state.lineStart = prevLineStart;
      }
    }

    if (statement.type === 'ExpressionStatement') {
      return `${state.lineStart}${this.generateExpression(statement.expression)};\n`;
    }

    if (statement.type === 'PrecisionQualifierStatement') {
      // No-op
      return '';
    }

    throw new Error(`Cannot generate ${statement.type} statements yet.`);
  }

  generate(vertexCode: string, fragmentCode: string): WgslGeneratorResult {
    // Initializing
    this.#lastUniqueIdSuffix = -1;
    const state: GenState = (this.#state = {
      shaderType: 'vertex',

      attributes: new Map(),
      varyings: new Map(),
      uniforms: new Map(),

      lastAttributeIdx: -1,
      lastVaryingIdx: -1,
      lastBindingIdx: -1,

      fakeVertexMainId: this.uniqueId('fake_vertex'),
      fakeFragmentMainId: this.uniqueId('fake_fragment'),

      lineStart: '',
      definingFunction: false,
    });

    const vertexAst = shaderkit.parse(vertexCode);
    const fragmentAst = shaderkit.parse(fragmentCode);

    let wgsl = `// Generated by byegl

var<private> gl_Position: vec4<f32>;
var<private> gl_FragColor: vec4<f32>;

`;

    state.lastVaryingIdx = -1;
    state.shaderType = 'vertex';
    for (const statement of vertexAst.body) {
      wgsl += this.generateStatement(statement);
    }

    state.lastVaryingIdx = -1;
    state.shaderType = 'fragment';
    for (const statement of fragmentAst.body) {
      wgsl += this.generateStatement(statement);
    }

    // Generating the real entry functions
    const attribParams = [...state.attributes.values()]
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
${[...state.varyings.values()].map((varying) => `  @location(${varying.location}) ${varying.id}: ${varying.type},`).join('\n')}
}

`;

    // Fragment input struct
    let fragInStructId: string | undefined;
    if (state.varyings.size > 0) {
      fragInStructId = this.uniqueId('FragmentIn');
      const fragInParams = [...state.varyings.values()]
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
${[...state.attributes.values()].map((attribute) => `  ${attribute.id} = ${attribute.paramId};\n`).join('')}

  ${state.fakeVertexMainId}();
  var output: ${vertOutStructId};
  output.${posOutParamId} = gl_Position;
  // NOTE: OpenGL uses z in the range [-1, 1], while WebGPU uses z in the range [0, 1].
  output.${posOutParamId}.z = output.${posOutParamId}.z * 0.5 + 0.5;
${[...state.varyings.values()].map((varying) => `  output.${varying.id} = ${varying.id};\n`).join('')}
  return output;
}

@fragment
fn ${this.uniqueId('frag_main')}(${fragInStructId ? `input: ${fragInStructId}` : ''}) -> @location(0) vec4f {
  // Filling proxies with varying data
${[...state.varyings.values()].map((varying) => `  ${varying.id} = input.${varying.id};\n`).join('')}
  ${this.#state.fakeFragmentMainId}();
  return gl_FragColor;
}
`;

    console.log('Generated:\n', wgsl);

    return {
      wgsl,
      attributeLocationMap: new Map(
        [...state.attributes.values()].map((info) => {
          return [info.id, info.location] as const;
        }),
      ),
      uniformLocationMap: new Map(
        [...state.uniforms.values()].map((info) => {
          return [info.id, info.bindingIdx] as const;
        }),
      ),
    };
  }
}
