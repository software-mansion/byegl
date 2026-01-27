import * as shaderkit from '@iwoplaza/shaderkit';
import tgpu, { TgpuFn } from 'typegpu';
import * as d from 'typegpu/data';
import { alignmentOf, sizeOf } from 'typegpu/data';
import {
  ByeglData,
  samplerType,
  texture1dType,
  texture2dArrayType,
  texture2dType,
  texture2dU32Type,
  texture3dType,
  textureCubeType,
  UnknownType,
} from '../data-types.ts';
import { ShaderCompilationError } from '../errors.ts';
import {
  AttributeInfo,
  UniformBufferLayout,
  UniformInfo,
  VaryingInfo,
  WgslGenerator,
  WgslGeneratorResult,
} from './wgsl-generator.ts';

interface PreprocessorMacro {
  args: string[];
  expr: shaderkit.Expression;
}

const glslToWgslTypeMap = {
  void: d.Void,
  int: d.i32,
  float: d.f32,
  bool: d.bool,
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
  sampler2DArray: texture2dArrayType,
  usampler2D: texture2dU32Type,
  sampler3D: texture3dType,
  samplerCube: textureCubeType,
};

// const glslToAlignedWgslTypeMap = {
//   int: d.struct({ v: d.align(16, d.i32) }),
//   float: d.struct({ v: d.align(16, d.f32) }),
//   vec2: d.struct({ v: d.align(16, d.vec2f) }),
//   ivec2: d.struct({ v: d.align(16, d.vec2i) }),
//   uvec2: d.struct({ v: d.align(16, d.vec2u) }),
// };

// const alignedTypes = Object.values(glslToAlignedWgslTypeMap);

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
  texture2dArrayType,
  texture3dType,
  textureCubeType,
  texture2dU32Type,
  samplerType,
]);

const opToPrecedence = {
  ',': 0,
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
  '.': 4,
};

const logicalOps = ['==', '!=', '>', '>=', '<', '<=', '!'];

/**
 * A helper function that polyfills the mat3(arg: mat4) constructor from GLSL
 */
const createMat3FromMat4 = tgpu.fn([d.mat4x4f], d.mat3x3f)`(arg4) {
  return mat3x3f(arg4[0].xyz, arg4[1].xyz, arg4[2].xyz);
}`.$name('_byegl_createMat3FromMat4');

/*
 * A helper function that mimics the behavior of modf's `out` parameter
 */
const modfWrapperFloat = tgpu.fn([d.f32, d.ptrFn(d.f32)], d.f32)`(arg, out) {
  let result = modf(arg);
  (*out) = result.whole;
  return result.fract;
}`.$name('_byegl_modfWrapperFloat');

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
  preprocessorDefines: Map<string, shaderkit.Expression>;
  preprocessorMacros: Map<string, PreprocessorMacro>;

  /**
   * A mapping of attribute locations to their corresponding property keys in the VertexIn struct.
   */
  attributePropKeys: Map<number, string>;

  /**
   * A mapping of varying locations to their corresponding property keys in the Varying struct.
   */
  varyingPropKeys: Map<number, string>;

  structDefs: Map<string, d.WgslStruct>;
  typeAliasMap: Map<ByeglData, string>;
  extraFunctions: Map<string, TgpuFn>;
  /**
   * Used to deduplicate definitions between the vertex shader and the fragment shader.
   * This system is not perfect, because there could be two definitions of the same name in
   * the two shaders, but with a different values.
   */
  alreadyDefined: Set<string>;
  aliases: Map<ByeglData, string>;
  variables: Map<string, ByeglData>;
  functions: Map<
    string,
    { params: { id: string; flow: 'in' | 'out' | 'inout' }[] }
  >;
  currentFunction: string | undefined;

  /** Used to track variable declarations with the `attribute` qualifier */
  lastAttributeIdx: number;
  /** Used to track variable declarations with the `varying` qualifier */
  lastVaryingIdx: number;
  /** Used to track variable declarations with the `uniform` qualifier */
  lastBindingIdx: number;

  /**
   * Names of uniforms (excluding textures/samplers) that go into the unified struct.
   */
  uniformStructMembers: Set<string>;

  /**
   * Non-texture/sampler uniform infos in order of declaration (for struct generation).
   */
  uniformStructInfos: UniformInfo[];
  uniformStructBindingIdx: number | undefined;

  fakeVertexMainId?: string | undefined;
  fakeFragmentMainId?: string | undefined;
  fragmentOutProxyId: string;

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

  preprocessorScope: number;
  disabledAtScope: number | undefined;
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

  getDataType(decl: {
    id: shaderkit.Identifier | shaderkit.ArraySpecifier | null;
    typeSpecifier: shaderkit.Identifier | shaderkit.ArraySpecifier;
  }): { id: string; dataType: ByeglData } {
    const state = this.#state;

    // TODO: Fix shaderkit array type specifiers
    const typeSpec = decl.typeSpecifier as shaderkit.Identifier;

    let dataType: ByeglData | undefined;
    if (typeSpec.name in glslToWgslTypeMap) {
      dataType =
        glslToWgslTypeMap[typeSpec.name as keyof typeof glslToWgslTypeMap];
    } else if (state.structDefs.has(typeSpec.name)) {
      dataType = state.structDefs.get(typeSpec.name)!;
    } else {
      throw new Error(`Unsupported type idenfifier: ${typeSpec.name}`);
    }

    let id: string;
    if (decl.id?.type === 'ArraySpecifier') {
      id = decl.id.typeSpecifier.name;

      const dims = decl.id.dimensions
        .filter((expr) => !!expr)
        .map((expr) => this.precomputeExpression(expr)) as number[];

      // TODO: 'uniform' storage requires that array elements are aligned to 16 bytes
      // dataType =
      //   typeSpec.name in glslToAlignedWgslTypeMap
      //     ? // TS is annoying sometimes
      //       glslToAlignedWgslTypeMap[typeSpec.name as never]
      //     : dataType;

      for (const dim of dims) {
        dataType = d.arrayOf(dataType as d.AnyWgslData, dim);
      }
    } else {
      id = decl.id?.name ?? '';
    }

    return {
      id,
      dataType,
    };
  }

  aliasOf(value: ByeglData): string {
    const state = this.#state;

    if (primitiveTypes.has(value)) {
      return (value as d.AnyWgslData).type;
    }

    if (state.typeAliasMap.has(value)) {
      return state.typeAliasMap.get(value)!;
    }

    // No alias yet, making one
    const alias = this.uniqueId('TYPE_ALIAS');
    state.typeAliasMap.set(value, alias);
    return alias;
  }

  forkState<T>(propsToChange: Partial<GenState>, cb: () => T): T {
    const oldPropValues = Object.fromEntries(
      Object.keys(propsToChange).map((key) => [
        key,
        this.#state[key as keyof GenState],
      ]),
    );

    Object.assign(this.#state, propsToChange);

    try {
      return cb();
    } finally {
      // Restoring state
      Object.assign(this.#state, oldPropValues);
    }
  }

  withTrace<T>(ancestor: string, cb: () => T): T {
    try {
      return cb();
    } catch (err) {
      if (err instanceof ShaderCompilationError) {
        throw err.appendToTrace(ancestor);
      }

      throw new ShaderCompilationError(err, [ancestor]);
    }
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

  /**
   * Adds the `modfWrapperFloat` function to the shader.
   * @returns the name of the function, which can be injected into the shader
   */
  useModfWrapperFloat(): string {
    const key = '_byegl_modfWrapperFloat';
    if (!this.#state.extraFunctions.has(key)) {
      this.#state.extraFunctions.set(key, modfWrapperFloat);
    }
    return key;
  }

  generateCallExpression(expression: shaderkit.CallExpression): Snippet {
    const state = this.#state;

    if (expression.callee.type !== 'Identifier') {
      throw new Error(`Unsupported callee type: ${expression.callee.type}`);
    }

    let funcName = expression.callee.name;

    // Is it a preprocessor define?
    if (state.preprocessorDefines.has(funcName)) {
      const define = state.preprocessorDefines.get(funcName)!;
      funcName = (define as shaderkit.Identifier).name;
    }

    const args = expression.arguments.map((arg) =>
      this.generateExpression(arg),
    );
    let argsValue = args.map((arg) => arg.value).join(', ');

    if (funcName === 'mat3' && args.length === 1) {
      // GLSL supports a mat3 constructor that takes in a mat4, while WGSL does not
      return snip(`${this.useCreateMat3FromMat4()}(${argsValue})`, d.mat3x3f);
    }

    if (funcName === 'modf') {
      // TODO: Bring back type check when type inference works properly
      // if (args[0].type === UnknownType || args[0].type.type !== 'f32') {
      //   throw new Error(`Unsupported modf parameter type: ${String(args[0].type)}`);
      // }
      return snip(
        `${this.useModfWrapperFloat()}(${args[0].value}, &${args[1].value})`,
        d.f32,
      );
    }

    if (funcName === 'texture2D' || funcName === 'texture') {
      const textureName = args[0].value;
      const sampler = state.textureToSamplerMap.get(textureName)!;
      const uv = args[1].value;
      return snip(
        `textureSample(${textureName}, ${sampler.id}, ${uv})`,
        d.vec4f,
      );
    }

    if (funcName === 'mod') {
      return snip(`(${args[0].value} % ${args[1].value})`, args[0].type);
    }

    if (funcName === 'atan' && args.length === 2) {
      return snip(`atan2(${args[0].value}, ${args[1].value})`, d.f32);
    }

    if (funcName === 'lessThanEqual') {
      return snip(`(${args[0].value} <= ${args[1].value})`, args[0].type);
    }

    if (funcName in glslToWgslTypeMap) {
      const dataType =
        glslToWgslTypeMap[funcName as keyof typeof glslToWgslTypeMap];
      return snip(`${dataType.type}(${argsValue})`, dataType);
    }

    if (state.structDefs.has(funcName)) {
      funcName = this.aliasOf(state.structDefs.get(funcName)!);
    }

    // It's a user-defined function, and we might need to change how arguments are passed
    const funcInfo = state.functions.get(funcName);
    if (funcInfo) {
      const modifiedArgs = args.map((arg, i) => {
        const param = funcInfo.params[i];
        if (param && (param.flow === 'out' || param.flow === 'inout')) {
          return snip(`&${arg.value}`, d.ptrFn(arg.type as d.AnyData));
        }
        return arg;
      });
      argsValue = modifiedArgs.map((a) => a.value).join(', ');
    }

    return snip(`${funcName}(${argsValue})`, UnknownType);
  }

  generateExpression(expression: shaderkit.Expression): Snippet {
    const state = this.#state;

    if (expression.type === 'Identifier') {
      // Is it a preprocessor define?
      if (state.preprocessorDefines.has(expression.name)) {
        const define = state.preprocessorDefines.get(expression.name)!;
        return this.generateExpression(define);
      }

      const varType = state.variables.get(expression.name);
      if (!varType && state.seekIdentifier) {
        throw new Error(`Variable not found: ${expression.name}`);
      }

      // Access uniforms through the unified struct
      if (state.uniformStructMembers.has(expression.name)) {
        return snip(`_uniforms.${expression.name}`, varType ?? UnknownType);
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
        `select(${consequent.value}, ${alternate.value}, bool(${test.value}))`,
        d.f32,
      );
    }

    if (expression.type === 'CallExpression') {
      return this.generateCallExpression(expression);
    }

    if (expression.type === 'AssignmentExpression') {
      const left = this.generateExpression(expression.left);
      const right = this.generateExpression(expression.right);
      let leftValue = left.value;
      if (expression.left.type === 'Identifier') {
        const funcInfo = state.functions.get(state.currentFunction || '');
        if (funcInfo) {
          const param = funcInfo.params.find(
            (p) => p.id === (expression.left as shaderkit.Identifier).name,
          );
          if (param && (param.flow === 'out' || param.flow === 'inout')) {
            leftValue = `*${leftValue}`;
          }
        }
      }
      return snip(
        `${leftValue} ${expression.operator} ${right.value}`,
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

        if (
          ((left.type as ByeglData).type?.startsWith('vec') ||
            (right.type as ByeglData).type?.startsWith('vec')) &&
          logicalOps.includes(expression.operator)
        ) {
          return snip(
            `all(${left.value} ${expression.operator} ${right.value})`,
            d.bool,
          );
        }

        if (myPrecedence < parentPrecedence) {
          return snip(
            `(${left.value} ${expression.operator} ${right.value})`,
            // TODO: Implement type inference
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
      const parentPrecedence = state.parentPrecedence;
      state.parentPrecedence = opToPrecedence['.'];
      const object = this.generateExpression(expression.object);
      state.parentPrecedence = parentPrecedence;

      const prevSeekIdentifier = state.seekIdentifier;
      let property: Snippet;
      try {
        state.seekIdentifier = false;
        property = this.generateExpression(expression.property);
      } finally {
        state.seekIdentifier = prevSeekIdentifier;
      }

      // TODO: Implement type inference
      if (expression.computed) {
        return snip(`${object.value}[${property.value}]`, UnknownType);
      }
      return snip(`${object.value}.${property.value}`, UnknownType);
    }

    if (expression.type === 'UpdateExpression') {
      const argument = this.generateExpression(expression.argument);
      // TODO: Implement type inference
      if (expression.prefix) {
        return snip(`${expression.operator}${argument.value}`, UnknownType);
      } else {
        return snip(`${argument.value}${expression.operator}`, UnknownType);
      }
    }

    throw new Error(`Unsupported expression type: ${expression.type}`);
  }

  precomputeExpression(expression: shaderkit.Expression): boolean | number {
    const state = this.#state;

    if (expression.type === 'Literal') {
      if (expression.value === 'false') {
        return false;
      }
      if (expression.value === 'true') {
        return true;
      }
      const numeric = Number.parseFloat(expression.value);
      if (!Number.isNaN(numeric)) {
        return numeric;
      }
      throw new Error(`Unsupported literal value: ${expression.value}`);
    }

    if (expression.type === 'Identifier') {
      const def = state.preprocessorDefines.get(expression.name);
      if (def !== undefined) {
        return this.precomputeExpression(def);
      }
      throw new Error(`Undefined identifier: ${expression.name}`);
    }

    if (expression.type === 'UnaryExpression') {
      const argument = this.precomputeExpression(expression.argument);

      if (expression.operator === '!') {
        return !argument;
      }

      throw new Error(`Unsupported unary operator: ${expression.operator}`);
    }

    if (expression.type === 'LogicalExpression') {
      const left = this.precomputeExpression(expression.left);
      const right = this.precomputeExpression(expression.right);

      if (expression.operator === '&&') {
        return left && right;
      }

      if (expression.operator === '||') {
        return left || right;
      }

      throw new Error(`Unsupported logical operator: ${expression.operator}`);
    }

    if (expression.type === 'BinaryExpression') {
      const left = this.precomputeExpression(expression.left);
      const right = this.precomputeExpression(expression.right);

      if (expression.operator === '+') {
        return (left as number) + (right as number);
      }

      if (expression.operator === '-') {
        return (left as number) - (right as number);
      }

      if (expression.operator === '*') {
        return (left as number) * (right as number);
      }

      if (expression.operator === '/') {
        return (left as number) / (right as number);
      }

      if (expression.operator === '%') {
        return (left as number) % (right as number);
      }

      if (expression.operator === '>') {
        return (left as number) > (right as number);
      }

      if (expression.operator === '<') {
        return (left as number) > (right as number);
      }

      throw new Error(`Unsupported binary operator: ${expression.operator}`);
    }

    if (expression.type === 'CallExpression') {
      if (
        expression.callee.type === 'Identifier' &&
        (expression.callee as shaderkit.Identifier).name === 'defined'
      ) {
        if (
          expression.arguments.length !== 1 ||
          expression.arguments[0].type !== 'Identifier'
        ) {
          throw new Error(
            `Invalid argument for defined() macro: ${JSON.stringify(expression.arguments)}`,
          );
        }

        const name = (expression.arguments[0] as shaderkit.Identifier).name;
        return state.preprocessorDefines.has(name);
      }
    }

    throw new Error(
      `Cannot precompute expression: ${JSON.stringify(expression)}`,
    );
  }

  generatePreprocessorStatement(
    statement: shaderkit.PreprocessorStatement,
  ): string {
    const state = this.#state;

    if (statement.name === 'endif') {
      if (state.disabledAtScope === state.preprocessorScope) {
        state.disabledAtScope = undefined;
      }
      state.preprocessorScope--;
      return '';
    }

    if (statement.name === 'ifdef' || statement.name === 'ifndef') {
      if (
        !statement.value ||
        statement.value.length !== 1 ||
        statement.value[0].type !== 'Identifier'
      ) {
        throw new Error(
          `Invalid #ifdef statement: ${JSON.stringify(statement.value)}`,
        );
      }

      const isDefined = state.preprocessorDefines.has(statement.value[0].name);
      state.preprocessorScope++;
      if (
        !state.disabledAtScope &&
        ((!isDefined && statement.name === 'ifdef') ||
          (isDefined && statement.name === 'ifndef'))
      ) {
        state.disabledAtScope = state.preprocessorScope;
      }
      return '';
    }

    if (statement.name === 'if') {
      if (!statement.value || statement.value.length !== 1) {
        throw new Error(
          `Invalid #if statement: ${JSON.stringify(statement.value)}`,
        );
      }

      const condition = this.precomputeExpression(statement.value[0]);
      state.preprocessorScope++;
      if (!state.disabledAtScope && !condition) {
        state.disabledAtScope = state.preprocessorScope;
      }
      return '';
    }

    if (statement.name === 'elif') {
      // If the adjacent if statement was disabling execution, the elif is supposed to run (given the condition is true)
      // If execution wasn't disabled, then the else should be skipped
      if (state.disabledAtScope === state.preprocessorScope) {
        const condition = this.precomputeExpression(statement.value![0]);
        state.disabledAtScope = condition ? undefined : state.preprocessorScope;
      } else if (state.disabledAtScope === undefined) {
        state.disabledAtScope = state.preprocessorScope;
      }
      return '';
    }

    if (statement.name === 'else') {
      // If the adjacent if statement was disabling execution, the else is supposed to run
      // If execution wasn't disabled, then the else should be skipped
      if (state.disabledAtScope === state.preprocessorScope) {
        state.disabledAtScope = undefined;
      } else if (state.disabledAtScope === undefined) {
        state.disabledAtScope = state.preprocessorScope;
      }
      return '';
    }

    if (state.disabledAtScope !== undefined) {
      // Skip the statement if it's disabled
      return '';
    }

    if (statement.name === 'version') {
      // Ignoring the version directive
      return '';
    }

    if (statement.name === 'define') {
      if (
        !statement.value ||
        statement.value.length < 1 ||
        statement.value.length > 2
      ) {
        throw new Error(
          `Invalid #define statement: ${JSON.stringify(statement.value)}`,
        );
      }

      if (statement.value[0].type === 'CallExpression') {
        if (!statement.value[1]) {
          throw new Error(
            `Malformed macro #define statement: ${JSON.stringify(statement.value)}`,
          );
        }

        const callee = statement.value[0].callee;
        if (callee.type !== 'Identifier') {
          throw new Error(
            `Expected identifier at the beginning of macro #define statement: ${JSON.stringify(statement.value)}`,
          );
        }
        const args = statement.value[0].arguments.map((arg) => {
          if (arg.type !== 'Identifier') {
            throw new Error(
              `Expected identifier as argument in macro #define statement: ${JSON.stringify(statement.value)}`,
            );
          }
          return arg.name;
        });

        state.preprocessorMacros.set(callee.name, {
          args,
          expr: statement.value[1],
        });

        return '';
      }

      if (statement.value[0].type !== 'Identifier') {
        throw new Error(
          `Expected identifier at the beginning of #define statement: ${JSON.stringify(statement.value)}`,
        );
      }

      const key = statement.value[0].name;

      if (!statement.value[1]) {
        state.preprocessorDefines.set(key, statement.value[0]);
        return '';
      }

      const value = statement.value[1];
      state.preprocessorDefines.set(key, value);
      return '';
    }

    return '';
  }

  generateStatement(statement: shaderkit.Statement): string {
    const state = this.#state;

    if (statement.type == 'PreprocessorStatement') {
      return this.generatePreprocessorStatement(statement);
    }

    if (state.disabledAtScope !== undefined) {
      // Skip generating statements
      return '';
    }

    if (statement.type === 'StructDeclaration') {
      const structType = d
        .struct(
          Object.fromEntries(
            statement.members.map((member) => {
              const decl = member.declarations[0];

              const { id, dataType } = this.getDataType(decl);
              return [id, dataType as d.AnyWgslData];
            }),
          ),
        )
        .$name(statement.id.name);

      state.aliases.set(structType, statement.id.name);
      state.structDefs.set(statement.id.name, structType);
      state.typeAliasMap.set(structType, statement.id.name);

      return '';
    }

    if (statement.type === 'VariableDeclaration') {
      let code = '';

      for (const decl of statement.declarations) {
        const qualifiers = decl.qualifiers;
        const isUniform = qualifiers.includes('uniform');
        const isConst = qualifiers.includes('const');
        const isAttribute =
          qualifiers.includes('attribute') ||
          (state.shaderType === 'vertex' && qualifiers.includes('in'));
        const isVarying =
          qualifiers.includes('varying') ||
          (state.shaderType === 'vertex' && qualifiers.includes('out')) ||
          (state.shaderType === 'fragment' && qualifiers.includes('in'));
        const isFragmentOut =
          state.shaderType === 'fragment' && qualifiers.includes('out');

        let { id, dataType } = this.getDataType(decl);

        if (isUniform) {
          // Booleans are not host-shareable
          if (dataType === d.bool) {
            dataType = d.u32;
          }
        }

        const wgslTypeAlias = this.aliasOf(dataType);

        if (state.alreadyDefined.has(id) && !state.definingFunction) {
          continue;
        }
        state.alreadyDefined.add(id);

        if (isFragmentOut) {
          // We don't generate the variable, as it replaced the builtin 'gl_FragColor' proxy.
          state.fragmentOutProxyId = id;
        } else if (isAttribute) {
          // Finding the next available attribute index
          do {
            state.lastAttributeIdx++;
          } while (state.attributes.has(state.lastAttributeIdx));

          state.attributePropKeys.set(state.lastAttributeIdx, id);

          state.attributes.set(state.lastAttributeIdx, {
            id: id,
            location: state.lastAttributeIdx,
            type: dataType as d.AnyWgslData,
          });

          // Defining proxies
          code += `/* attribute */ var<private> ${id}: ${wgslTypeAlias};\n`;
        } else if (isVarying) {
          // Finding the next available varying index
          do {
            state.lastVaryingIdx++;
          } while (state.varyings.has(state.lastVaryingIdx));

          if (state.shaderType === 'vertex') {
            // Only generating in the vertex shader

            state.varyingPropKeys.set(state.lastVaryingIdx, this.uniqueId(id));

            state.varyings.set(state.lastVaryingIdx, {
              id,
              location: state.lastVaryingIdx,
              type: dataType as d.AnyWgslData,
            });

            // Defining proxies
            code += `/* varying */ var<private> ${id}: ${wgslTypeAlias};\n`;
          }
        } else if (isUniform) {
          // Textures need an accompanying sampler - they get individual bindings
          if (dataType.type.startsWith('texture_')) {
            // Finding the next available uniform index for texture
            do {
              state.lastBindingIdx++;
            } while (state.uniforms.has(state.lastBindingIdx));

            const uniformInfo: UniformInfo = {
              id: id,
              location: state.lastBindingIdx,
              type: dataType,
            };
            state.uniforms.set(state.lastBindingIdx, uniformInfo);

            code += `@group(${this.#bindingGroupIdx}) @binding(${state.lastBindingIdx}) var ${id}: ${wgslTypeAlias};\n`;

            // Finding the next available uniform index for sampler
            do {
              state.lastBindingIdx++;
            } while (state.uniforms.has(state.lastBindingIdx));

            const samplerId = this.uniqueId(id + '_sampler');
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
            // Non-texture uniforms go into the unified struct
            if (state.uniformStructBindingIdx === undefined) {
              // Finding the next available uniform index for texture
              do {
                state.lastBindingIdx++;
              } while (state.uniforms.has(state.lastBindingIdx));
              state.uniformStructBindingIdx = state.lastBindingIdx;
            }
            const uniformInfo: UniformInfo = {
              id: id,
              location: state.uniformStructBindingIdx,
              type: dataType,
            };
            state.uniformStructMembers.add(id);
            state.uniformStructInfos.push(uniformInfo);
            // Don't emit code here - struct will be generated at the end
          }
        } else if (isConst) {
          // Const
          code += `${state.lineStart}const ${id}: ${wgslTypeAlias} = ${this.generateExpression(decl.init!).value};\n`;
        } else {
          // Regular variable
          if (decl.init) {
            code += `${state.lineStart}var${state.definingFunction ? '' : '<private>'} ${id}: ${wgslTypeAlias} = ${this.generateExpression(decl.init).value};\n`;
          } else {
            code += `${state.lineStart}var${state.definingFunction ? '' : '<private>'} ${id}: ${wgslTypeAlias};\n`;
          }
        }

        state.variables.set(id, dataType);

        // TODO: Handle manual layout qualifiers (e.g. layout(location=0))
      }
      return code;
    }

    if (statement.type === 'FunctionDeclaration') {
      let funcName = statement.id.name;
      if (funcName === 'main') {
        // We're generating the entry function!
        // We approach it by generating a "fake" entry function
        // that gets called by the actual entry function.
        if (state.shaderType === 'vertex') {
          funcName = state.fakeVertexMainId =
            state.fakeVertexMainId ?? this.uniqueId('fake_vertex');
        } else {
          funcName = state.fakeFragmentMainId =
            state.fakeFragmentMainId ?? this.uniqueId('fake_fragment');
        }
      }

      if (state.alreadyDefined.has(funcName)) {
        return '';
      }
      state.alreadyDefined.add(funcName);

      return this.withTrace(`fn:${funcName}`, () =>
        this.forkState(
          {
            // A new scope
            variables: new Map(state.variables),
            definingFunction: true,
            currentFunction: funcName,
            lineStart: state.lineStart + '  ',
          },
          () => {
            const paramInfos = statement.params.map((param) => {
              const qualifiers = param.qualifiers || [];
              const { id, dataType } = this.getDataType(param);
              let flow: 'in' | 'out' | 'inout' = 'in';
              if (qualifiers.includes('inout')) {
                flow = 'inout';
              } else if (qualifiers.includes('out')) {
                flow = 'out';
              }
              let finalDataType = dataType;
              if (flow === 'out' || flow === 'inout') {
                finalDataType = d.ptrFn(dataType as d.AnyData);
              }
              return { id, dataType: finalDataType, flow };
            });
            state.functions.set(funcName, {
              params: paramInfos.map((p) => ({
                id: p.id,
                flow: p.flow,
              })),
            });
            const paramSnippets = paramInfos
              .filter((param) => !!param.id)
              .map((param) => snip(param.id, param.dataType));

            for (const param of paramSnippets) {
              state.variables.set(param.value, param.type as ByeglData);
            }

            const paramsValue = paramSnippets
              .map(
                (param) =>
                  `${param.value}: ${this.aliasOf(param.type as ByeglData)}`,
              )
              .join(', ');

            const { dataType: returnType } = this.getDataType(statement);

            const body = statement.body?.body
              .map((stmt) => this.generateStatement(stmt))
              .join('');

            if (returnType === d.Void) {
              return `\nfn ${funcName}(${paramsValue}) {\n${body}}\n`;
            } else {
              return `\nfn ${funcName}(${paramsValue}) -> ${this.aliasOf(returnType)} {\n${body}}\n`;
            }
          },
        ),
      );
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

    if (statement.type === 'ForStatement') {
      const initNode = statement.init;
      const init = initNode
        ? initNode.type === 'VariableDeclaration'
          ? this.forkState({ lineStart: '' }, () =>
              this.generateStatement(initNode).slice(0, -1),
            )
          : this.generateExpression(initNode).value
        : ';';

      const test = statement.test
        ? this.generateExpression(statement.test).value
        : '';

      const update = statement.update
        ? this.generateExpression(statement.update).value
        : '';

      const body = this.forkState(
        {
          lineStart: state.lineStart + '  ',
        },
        () => this.generateStatement(statement.body),
      );

      return `${state.lineStart}for (${init} ${test}; ${update}) {\n${body}${state.lineStart}}\n`;
    }

    throw new Error(`Cannot generate ${statement.type} statements yet.`);
  }

  generate(vertexCode: string, fragmentCode: string): WgslGeneratorResult {
    // Initializing
    this.#lastUniqueIdSuffix = -1;
    const state: GenState = (this.#state = {
      shaderType: 'vertex',

      preprocessorDefines: new Map(),
      preprocessorMacros: new Map(),
      preprocessorScope: 0,
      disabledAtScope: undefined,

      alreadyDefined: new Set(),
      structDefs: new Map(),
      typeAliasMap: new Map(),
      extraFunctions: new Map(),
      aliases: new Map(),
      variables: new Map<string, d.AnyWgslData>([
        ['gl_Position', d.vec4f],
        ['gl_FragColor', d.vec4f],
        ['gl_FragDepth', d.f32],
        ['gl_FrontFacing', d.bool],
      ]),
      functions: new Map(),
      currentFunction: undefined,
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

      uniformStructMembers: new Set(),
      uniformStructInfos: [],
      uniformStructBindingIdx: undefined,

      fragmentOutProxyId: 'gl_FragColor',

      lineStart: '',
      definingFunction: false,
      parentPrecedence: 0,
      seekIdentifier: true,
    });

    let vertexAst: shaderkit.Program;
    let fragmentAst: shaderkit.Program;
    try {
      vertexAst = shaderkit.parse(vertexCode);
    } catch (error) {
      console.error('Error parsing vertex shader:', vertexCode);
      console.error(error);
      throw error;
    }
    try {
      fragmentAst = shaderkit.parse(fragmentCode);
    } catch (error) {
      console.error('Error parsing fragment shader:', fragmentCode);
      console.error(error);
      throw error;
    }

    let wgsl = '\n\n';

    state.lastVaryingIdx = -1;
    state.shaderType = 'vertex';
    try {
      for (const statement of vertexAst.body) {
        wgsl += this.generateStatement(statement);
      }
    } catch (error) {
      console.error('Code generated thus far:', wgsl);
      throw error;
    }

    state.lastVaryingIdx = -1;
    state.shaderType = 'fragment';
    for (const statement of fragmentAst.body) {
      wgsl += this.generateStatement(statement);
    }

    wgsl += `
var<private> gl_Position: vec4f;
var<private> gl_FrontFacing: bool;
var<private> ${state.fragmentOutProxyId}: vec4f;
`;

    // Generating the real entry functions

    if (state.fakeVertexMainId) {
      let vertexInStructId: string | undefined;
      if (state.attributes.size > 0) {
        vertexInStructId = this.uniqueId('VertexIn');
        wgsl += `
struct ${vertexInStructId} {
${[...state.attributes.values()].map((attribute) => `@location(${attribute.location}) ${state.attributePropKeys.get(attribute.location)}: ${this.aliasOf(attribute.type)},`).join('\n')}
}`;
      }

      // Vertex output struct
      const vertOutStructId = this.uniqueId('VertexOut');
      const posOutParamId = this.uniqueId('posOut');
      wgsl += `
struct ${vertOutStructId} {
  @builtin(position) ${posOutParamId}: vec4f,
${[...state.varyings.values()].map((varying) => `  @location(${varying.location}) ${varying.id}: ${this.aliasOf(varying.type)},`).join('\n')}
}

`;

      wgsl += `
@vertex
fn ${this.uniqueId('vert_main')}(${vertexInStructId ? `input: ${vertexInStructId}` : ''}) -> ${vertOutStructId} {
${[...state.attributes.values()].map((attribute) => `  ${attribute.id} = input.${attribute.id};\n`).join('')}

  ${state.fakeVertexMainId}();
  var output: ${vertOutStructId};
  output.${posOutParamId} = gl_Position;
  // NOTE: OpenGL uses z in the range [-1, 1], while WebGPU uses z in the range [0, 1].
  output.${posOutParamId}.z = output.${posOutParamId}.z * 0.5 + 0.5;
${[...state.varyings.values()].map((varying) => `  output.${varying.id} = ${varying.id};\n`).join('')}
  return output;
}
`;
    }

    if (state.fakeFragmentMainId) {
      // Fragment input struct
      const fragInStructId = this.uniqueId('FragmentIn');
      const frontFacingParamId = this.uniqueId('frontFacing');
      const fragInParams = [...state.varyings.values()]
        .map(
          (varying) =>
            `  @location(${varying.location}) ${varying.id}: ${this.aliasOf(varying.type)},`,
        )
        .join('\n');
      wgsl += `
struct ${fragInStructId} {
  @builtin(front_facing) ${frontFacingParamId}: bool,
${fragInParams}
}

`;

      wgsl += `
@fragment
fn ${this.uniqueId('frag_main')}(${fragInStructId ? `input: ${fragInStructId}` : ''}) -> @location(0) vec4f {
  // Filling proxies with varying data
  gl_FrontFacing = input.${frontFacingParamId};
${[...state.varyings.values()].map((varying) => `  ${varying.id} = input.${varying.id};\n`).join('')}
  ${state.fakeFragmentMainId}();
  return ${state.fragmentOutProxyId};
}
`;
    }

    // Generate the unified uniform struct and calculate layout
    let uniformBufferLayout: UniformBufferLayout | undefined;
    const textureUniforms: UniformInfo[] = [];

    // Collect texture uniforms (they keep individual bindings)
    for (const uniformInfo of state.uniforms.values()) {
      textureUniforms.push(uniformInfo);
    }

    if (state.uniformStructBindingIdx !== undefined) {
      // Calculate offsets for each uniform respecting WGSL alignment rules
      const offsets = new Map<string, number>();
      let currentOffset = 0;

      for (const uniformInfo of state.uniformStructInfos) {
        const dataType = uniformInfo.type as d.AnyWgslData;
        // Making the alignment be a multiple of 16
        const alignment = Math.ceil(alignmentOf(dataType) / 16) * 16;
        // Align to the next boundary
        currentOffset = Math.ceil(currentOffset / alignment) * alignment;
        offsets.set(uniformInfo.id, currentOffset);
        currentOffset += sizeOf(dataType);
      }

      // Align total size to 16 bytes (uniform buffer alignment requirement)
      const totalSize = Math.ceil(currentOffset / 16) * 16;

      uniformBufferLayout = {
        totalSize: totalSize || 16, // Minimum 16 bytes
        offsets,
        bindingIndex: state.uniformStructBindingIdx,
      };

      // Generate the uniform struct and prepend it (will be resolved by tgpu.resolve)
      // Note: we add a leading newline since tgpu.resolve may prepend type definitions without trailing newlines
      const uniformStructId = '_Uniforms';
      let uniformStructCode = `\nstruct ${uniformStructId} {\n`;
      for (const uniformInfo of state.uniformStructInfos) {
        const wgslType = this.aliasOf(uniformInfo.type);
        uniformStructCode += `  @align(16) ${uniformInfo.id}: ${wgslType},\n`;
      }
      uniformStructCode += `}\n`;
      uniformStructCode += `@group(${this.#bindingGroupIdx}) @binding(${state.uniformStructBindingIdx}) var<uniform> _uniforms: ${uniformStructId};\n`;

      // Prepend the uniform declarations
      wgsl = uniformStructCode + '\n' + wgsl;
    }

    const resolvedWgsl =
      '// Generated by byegl\n\n' +
      tgpu.resolve({
        template: wgsl,
        externals: Object.fromEntries([
          ...state.typeAliasMap.entries().map(([data, alias]) => [alias, data]),
          ...state.extraFunctions.entries(),
        ]),
      });

    return {
      wgsl: resolvedWgsl,
      attributes: [...state.attributes.values()],
      uniforms: [...state.uniformStructInfos, ...state.uniforms.values()],
      textureUniforms,
      samplerToTextureMap: state.samplerToTextureMap,
      uniformBufferLayout,
    };
  }
}
