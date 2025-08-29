import * as shaderkit from '@iwoplaza/shaderkit';
import tgpu, { TgpuFn } from 'typegpu';
import * as d from 'typegpu/data';
import {
  AttributeInfo,
  ByeglData,
  samplerType,
  texture1dType,
  texture2dType,
  texture3dType,
  textureCubeType,
  UniformInfo,
  UnknownType,
  VaryingInfo,
  WgslGenerator,
  WgslGeneratorResult,
} from './wgsl-generator.ts';

const glslToWgslTypeMap = {
  float: d.f32,
  vec2: d.vec2f,
  vec3: d.vec3f,
  vec4: d.vec4f,
  ivec2: d.vec2i,
  ivec3: d.vec3i,
  ivec4: d.vec4i,
  uvec2: d.vec2u,
  uvec3: d.vec3u,
  uvec4: d.vec4u,
  mat2: d.mat2x2f,
  mat3: d.mat3x3f,
  mat4: d.mat4x4f,
  sampler1D: texture1dType,
  sampler2D: texture2dType,
  sampler3D: texture3dType,
  samplerCube: textureCubeType,
};

const primitiveTypes: Set<ByeglData> = new Set([
  d.f32,
  d.f16,
  d.i32,
  d.u32,
  d.bool,
  d.vec2f,
  d.vec2h,
  d.vec2i,
  d.vec2u,
  d.vec2b,
  d.vec3f,
  d.vec3h,
  d.vec3i,
  d.vec3u,
  d.vec3b,
  d.vec4f,
  d.vec4h,
  d.vec4i,
  d.vec4u,
  d.vec4b,
  d.mat2x2f,
  d.mat3x3f,
  d.mat4x4f,
  texture1dType,
  texture2dType,
  texture3dType,
  textureCubeType,
  samplerType,
]);

const opToPrecedence = {
  '+': 1,
  '-': 1,
  '*': 2,
  '/': 2,
  '%': 2,
  '==': 3,
  '!=': 3,
  '<': 3,
  '<=': 3,
  '>': 3,
  '>=': 3,
  '<<': 3,
  '>>': 3,
  '|': 3,
  '^': 3,
  '&': 3,
};

/**
 * A helper function that polyfills the mat3(arg: mat4) constructor from GLSL
 */
const createMat3FromMat4 = tgpu.fn([d.mat4x4f], d.mat3x3f)`(arg4) {
  return mat3x3f(arg4[0].xyz, arg4[1].xyz, arg4[2].xyz);
}`.$name('_byegl_createMat3FromMat4');

/**
 * A piece of generated WGSL code, inferred to be a specific WGSL data type.
 */
class Snippet {
  constructor(
    public value: string,
    public type: ByeglData | UnknownType,
  ) {}
}

/**
 * A helper function for creating "snippets"
 */
const snip = (value: string, type: ByeglData | UnknownType) =>
  new Snippet(value, type);

interface GenState {
  shaderType: 'vertex' | 'fragment';

  attributes: Map<number, AttributeInfo>;
  varyings: Map<number, VaryingInfo>;
  uniforms: Map<number, UniformInfo>;
  textureToSamplerMap: Map<string, UniformInfo>;
  samplerToTextureMap: Map<UniformInfo, UniformInfo>;

  /**
   * A mapping of attribute locations to their corresponding property keys in the VertexIn struct.
   */
  attributePropKeys: Map<number, string>;

  /**
   * A mapping of varying locations to their corresponding property keys in the Varying struct.
   */
  varyingPropKeys: Map<number, string>;

  typeDefs: Map<string, d.WgslStruct>;
  extraFunctions: Map<string, TgpuFn>;
  aliases: Map<ByeglData, string>;
  variables: Map<string, ByeglData>;

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
  parentPrecedence: number;

  /**
   * Whether to seek identifiers in the current scope, or just
   * return an expression with an unknown type.
   * The latter case is useful when generating member access, since
   * the property name is an identifier that does not have
   * a type of it's own.
   */
  seekIdentifier: boolean;
}

export class ShaderkitWGSLGenerator implements WgslGenerator {
  /**
   * NOTE: Always assuming 0, but it may be wise to make this customizable
   */
  #bindingGroupIdx = 0;
  #state!: GenState;

  #lastUniqueIdSuffix = -1;

  uniqueId(primer?: string | undefined): string {
    return `_byegl_${primer ?? 'item'}_${++this.#lastUniqueIdSuffix}`;
  }

  getDataType(
    typeSpecifier: shaderkit.Identifier | shaderkit.ArraySpecifier,
  ): ByeglData {
    const state = this.#state;
    if (typeSpecifier.type === 'Identifier') {
      if (typeSpecifier.name in glslToWgslTypeMap) {
        return glslToWgslTypeMap[
          typeSpecifier.name as keyof typeof glslToWgslTypeMap
        ];
      }

      if (typeSpecifier.name === 'void') {
        return d.Void;
      }

      if (state.typeDefs.has(typeSpecifier.name)) {
        return state.typeDefs.get(typeSpecifier.name)!;
      }

      throw new Error(`Unsupported type idenfifier: ${typeSpecifier.name}`);
    }

    throw new Error(`Unsupported type specifier: ${typeSpecifier.type}`);
  }

  aliasOf(value: ByeglData): string {
    if (primitiveTypes.has(value)) {
      return (value as d.AnyWgslData).type;
    }

    const alias = this.#state.aliases.get(value);
    if (alias) {
      return alias;
    }
    throw new Error(`No alias found for: ${String(value)}`);
  }

  /**
   * Adds the `createMat3FromMat4` function to the shader.
   * @returns the name of the function, which can be injected into the shader
   */
  useCreateMat3FromMat4(): string {
    const key = '_byegl_createMat3FromMat4';
    if (!this.#state.extraFunctions.has(key)) {
      this.#state.extraFunctions.set(key, createMat3FromMat4);
    }
    return key;
  }

  generateCallExpression(expression: shaderkit.CallExpression): Snippet {
    const state = this.#state;

    if (expression.callee.type !== 'Identifier') {
      throw new Error(`Unsupported callee type: ${expression.callee.type}`);
    }

    let funcName = expression.callee.name;
    const args = expression.arguments.map((arg) =>
      this.generateExpression(arg),
    );
    const argsValue = args.map((arg) => arg.value).join(', ');

    if (funcName === 'mat3') {
      // GLSL supports a mat3 constructor that takes in a mat4, while WGSL does not
      return snip(`${this.useCreateMat3FromMat4()}(${argsValue})`, d.mat3x3f);
    }

    if (funcName === 'texture2D') {
      const textureName = args[0].value;
      const sampler = state.textureToSamplerMap.get(textureName);
      const uv = args[1].value;
      return snip(
        `textureSample(${textureName}, ${sampler.id}, ${uv})`,
        d.vec4f,
      );
    }

    if (funcName in glslToWgslTypeMap) {
      const dataType =
        glslToWgslTypeMap[funcName as keyof typeof glslToWgslTypeMap];
      return snip(`${dataType.type}(${argsValue})`, dataType);
    }

    if (state.typeDefs.has(funcName)) {
      funcName = this.aliasOf(state.typeDefs.get(funcName)!);
    }

    return snip(`${funcName}(${argsValue})`, UnknownType);
  }

  generateExpression(expression: shaderkit.Expression): Snippet {
    const state = this.#state;

    if (expression.type === 'Identifier') {
      const varType = state.variables.get(expression.name);
      if (!varType && state.seekIdentifier) {
        throw new Error(`Variable not found: ${expression.name}`);
      }
      return snip(expression.name, varType ?? UnknownType);
    }

    if (expression.type === 'Literal') {
      // TODO: Infer the type of the literal
      return snip(expression.value, d.f32);
    }

    if (expression.type === 'ConditionalExpression') {
      // TODO: Not 100% accurate, but works for now
      const test = this.generateExpression(expression.test);
      const consequent = this.generateExpression(expression.consequent);
      const alternate = this.generateExpression(expression.alternate);
      // TODO: Infer the type of the conditional expression based on the operands
      return snip(
        `select(${consequent.value}, ${alternate.value}, ${test.value})`,
        d.f32,
      );
    }

    if (expression.type === 'CallExpression') {
      return this.generateCallExpression(expression);
    }

    if (expression.type === 'AssignmentExpression') {
      const left = this.generateExpression(expression.left);
      const right = this.generateExpression(expression.right);
      return snip(
        `${left.value} ${expression.operator} ${right.value}`,
        left.type,
      );
    }

    if (expression.type === 'BinaryExpression') {
      const parentPrecedence = state.parentPrecedence;
      try {
        const myPrecedence = opToPrecedence[expression.operator];
        state.parentPrecedence = myPrecedence;
        const left = this.generateExpression(expression.left);
        const right = this.generateExpression(expression.right);
        state.parentPrecedence = parentPrecedence;

        // TODO: Implement type inference
        if (myPrecedence < parentPrecedence) {
          return snip(
            `(${left.value} ${expression.operator} ${right.value})`,
            UnknownType,
          );
        }
        return snip(
          `${left.value} ${expression.operator} ${right.value}`,
          UnknownType,
        );
      } finally {
        state.parentPrecedence = parentPrecedence;
      }
    }

    if (expression.type === 'UnaryExpression') {
      const argument = this.generateExpression(expression.argument);
      // TODO: Implement type inference
      return snip(`${expression.operator}${argument.value}`, UnknownType);
    }

    if (expression.type === 'MemberExpression') {
      const object = this.generateExpression(expression.object);
      const prevSeekIdentifier = state.seekIdentifier;
      let property: Snippet;
      try {
        state.seekIdentifier = false;
        property = this.generateExpression(expression.property);
      } finally {
        state.seekIdentifier = prevSeekIdentifier;
      }
      // TODO: Implement type inference
      return snip(`${object.value}.${property.value}`, UnknownType);
    }

    throw new Error(`Unsupported expression type: ${expression.type}`);
  }

  generateStatement(statement: shaderkit.Statement): string {
    const state = this.#state;

    if (statement.type === 'StructDeclaration') {
      const structType = d
        .struct(
          Object.fromEntries(
            statement.members.map((member) => {
              const decl = member.declarations[0];
              const type = this.getDataType(decl.typeSpecifier);
              return [decl.id.name, type as d.AnyWgslData];
            }),
          ),
        )
        .$name(statement.id.name);

      state.aliases.set(structType, statement.id.name);
      state.typeDefs.set(statement.id.name, structType);

      return '';
    }

    if (statement.type === 'VariableDeclaration') {
      let code = '';

      for (const decl of statement.declarations) {
        const wgslType = this.getDataType(decl.typeSpecifier);
        const wgslTypeAlias = this.aliasOf(wgslType);

        if (decl.qualifiers.includes('attribute')) {
          // Finding the next available attribute index
          do {
            state.lastAttributeIdx++;
          } while (state.attributes.has(state.lastAttributeIdx));

          state.attributePropKeys.set(
            state.lastAttributeIdx,
            this.uniqueId(decl.id.name),
          );

          state.attributes.set(state.lastAttributeIdx, {
            id: decl.id.name,
            location: state.lastAttributeIdx,
            type: wgslType as d.AnyWgslData,
          });

          // Defining proxies
          code += `/* attribute */ var<private> ${decl.id.name}: ${wgslTypeAlias};\n`;
        } else if (decl.qualifiers.includes('varying')) {
          // Finding the next available varying index
          do {
            state.lastVaryingIdx++;
          } while (state.varyings.has(state.lastVaryingIdx));

          if (state.shaderType === 'vertex') {
            // Only generating in the vertex shader

            state.varyingPropKeys.set(
              state.lastVaryingIdx,
              this.uniqueId(decl.id.name),
            );

            state.varyings.set(state.lastVaryingIdx, {
              id: decl.id.name,
              location: state.lastVaryingIdx,
              type: wgslType as d.AnyWgslData,
            });

            // Defining proxies
            code += `/* varying */ var<private> ${decl.id.name}: ${wgslTypeAlias};\n`;
          }
        } else if (decl.qualifiers.includes('uniform')) {
          // Finding the next available uniform index
          do {
            state.lastBindingIdx++;
          } while (state.uniforms.has(state.lastBindingIdx));

          const uniformInfo: UniformInfo = {
            id: decl.id.name,
            location: state.lastBindingIdx,
            type: wgslType,
          };
          state.uniforms.set(state.lastBindingIdx, uniformInfo);

          // Textures need an accompanying sampler
          if (wgslType.type.startsWith('texture_')) {
            code += `@group(${this.#bindingGroupIdx}) @binding(${state.lastBindingIdx}) var ${decl.id.name}: ${wgslTypeAlias};\n`;

            // Finding the next available uniform index
            do {
              state.lastBindingIdx++;
            } while (state.uniforms.has(state.lastBindingIdx));

            const samplerId = this.uniqueId(decl.id.name + '_sampler');
            const samplerUniformInfo: UniformInfo = {
              id: samplerId,
              location: state.lastBindingIdx,
              type: samplerType,
            };
            state.uniforms.set(state.lastBindingIdx, samplerUniformInfo);
            state.samplerToTextureMap.set(samplerUniformInfo, uniformInfo);
            state.textureToSamplerMap.set(uniformInfo.id, samplerUniformInfo);

            code += `@group(${this.#bindingGroupIdx}) @binding(${state.lastBindingIdx}) var ${samplerId}: sampler;\n`;
          } else {
            code += `@group(${this.#bindingGroupIdx}) @binding(${state.lastBindingIdx}) var<uniform> ${decl.id.name}: ${wgslTypeAlias};\n`;
          }
        } else {
          // Regular variable
          if (decl.init) {
            code += `${state.lineStart}var${state.definingFunction ? '' : '<private>'} ${decl.id.name}: ${wgslTypeAlias} = ${this.generateExpression(decl.init).value};\n`;
          } else {
            code += `${state.lineStart}var${state.definingFunction ? '' : '<private>'} ${decl.id.name}: ${wgslTypeAlias};\n`;
          }
        }

        state.variables.set(decl.id.name, wgslType);

        // TODO: Handle manual layout qualifiers (e.g. layout(location=0))
      }
      return code;
    }

    if (statement.type === 'FunctionDeclaration') {
      let funcName = statement.id.name;

      // A new scope
      const oldVariables = state.variables;
      const prevDefiningFunction = state.definingFunction;
      const prevLineStart = state.lineStart;

      state.variables = new Map(state.variables);

      try {
        const params = statement.params.map((param) =>
          snip(param.id?.name!, this.getDataType(param.typeSpecifier)),
        );

        for (const param of params) {
          state.variables.set(param.value, param.type as ByeglData);
        }

        const paramsValue = params
          .map(
            (param) =>
              `${param.value}: ${this.aliasOf(param.type as ByeglData)}`,
          )
          .join(', ');

        const returnType = this.getDataType(statement.typeSpecifier);

        if (funcName === 'main') {
          // We're generating the entry function!
          // We approach it by generating a "fake" entry function
          // that gets called by the actual entry function.
          funcName =
            state.shaderType === 'vertex'
              ? state.fakeVertexMainId
              : state.fakeFragmentMainId;
        }

        state.definingFunction = true;
        state.lineStart += '  ';
        const body = statement.body?.body
          .map((stmt) => this.generateStatement(stmt))
          .join('');

        if (returnType === d.Void) {
          return `\nfn ${funcName}(${paramsValue}) {\n${body}}\n`;
        } else {
          return `\nfn ${funcName}(${paramsValue}) -> ${this.aliasOf(returnType)} {\n${body}}\n`;
        }
      } finally {
        // Restoring the state
        state.variables = oldVariables;
        state.definingFunction = prevDefiningFunction;
        state.lineStart = prevLineStart;
      }
    }

    if (statement.type === 'ExpressionStatement') {
      return `${state.lineStart}${this.generateExpression(statement.expression).value};\n`;
    }

    if (statement.type === 'BlockStatement') {
      const body = statement.body
        .map((stmt) => this.generateStatement(stmt))
        .join('');

      return body;
    }

    if (statement.type === 'PrecisionQualifierStatement') {
      // No-op
      return '';
    }

    if (statement.type === 'ReturnStatement') {
      if (statement.argument) {
        return `${state.lineStart}return ${this.generateExpression(statement.argument).value};\n`;
      } else {
        return `${state.lineStart}return;\n`;
      }
    }

    if (statement.type === 'IfStatement') {
      const condition = this.generateExpression(statement.test);
      const consequent = this.generateStatement(statement.consequent);
      const alternate = statement.alternate
        ? this.generateStatement(statement.alternate)
        : undefined;

      if (alternate) {
        return `${state.lineStart}if (${condition.value}) {\n${consequent}\n} else {\n${alternate}\n}`;
      } else {
        return `${state.lineStart}if (${condition.value}) {\n${consequent}\n}`;
      }
    }

    throw new Error(`Cannot generate ${statement.type} statements yet.`);
  }

  generate(vertexCode: string, fragmentCode: string): WgslGeneratorResult {
    // Initializing
    this.#lastUniqueIdSuffix = -1;
    const state: GenState = (this.#state = {
      shaderType: 'vertex',

      typeDefs: new Map(),
      extraFunctions: new Map(),
      aliases: new Map(),
      variables: new Map<string, d.AnyWgslData>([
        ['gl_Position', d.vec4f],
        ['gl_FragColor', d.vec4f],
        ['gl_FragDepth', d.f32],
      ]),
      attributes: new Map(),
      varyings: new Map(),
      uniforms: new Map(),
      samplerToTextureMap: new Map(),
      textureToSamplerMap: new Map(),

      attributePropKeys: new Map(),
      varyingPropKeys: new Map(),

      lastAttributeIdx: -1,
      lastVaryingIdx: -1,
      lastBindingIdx: -1,

      fakeVertexMainId: this.uniqueId('fake_vertex'),
      fakeFragmentMainId: this.uniqueId('fake_fragment'),

      lineStart: '',
      definingFunction: false,
      parentPrecedence: 0,
      seekIdentifier: true,
    });

    const vertexAst = shaderkit.parse(vertexCode);
    const fragmentAst = shaderkit.parse(fragmentCode);

    let wgsl = `\
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
          `@location(${attribute.location}) ${state.attributePropKeys.get(attribute.location)}: ${this.aliasOf(attribute.type)}`,
      )
      .join(', ');

    // Vertex output struct
    const vertOutStructId = this.uniqueId('VertexOut');
    const posOutParamId = this.uniqueId('posOut');
    wgsl += `
struct ${vertOutStructId} {
  @builtin(position) ${posOutParamId}: vec4f,
${[...state.varyings.values()].map((varying) => `  @location(${varying.location}) ${varying.id}: ${this.aliasOf(varying.type)},`).join('\n')}
}

`;

    // Fragment input struct
    let fragInStructId: string | undefined;
    if (state.varyings.size > 0) {
      fragInStructId = this.uniqueId('FragmentIn');
      const fragInParams = [...state.varyings.values()]
        .map(
          (varying) =>
            `  @location(${varying.location}) ${varying.id}: ${this.aliasOf(varying.type)},`,
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
${[...state.attributes.values()].map((attribute) => `  ${attribute.id} = ${state.attributePropKeys.get(attribute.location)};\n`).join('')}

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

    const resolvedWgsl =
      '// Generated by byegl\n\n' +
      tgpu.resolve({
        template: wgsl,
        externals: Object.fromEntries([
          ...state.typeDefs.entries(),
          ...state.extraFunctions.entries(),
        ]),
      });

    console.log('Generated:\n', resolvedWgsl);

    return {
      wgsl: resolvedWgsl,
      attributes: [...state.attributes.values()],
      uniforms: [...state.uniforms.values()],
      samplerToTextureMap: state.samplerToTextureMap,
    };
  }
}
