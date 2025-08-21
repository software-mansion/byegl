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
  mat2: 'mat2f',
  mat3: 'mat3f',
  mat4: 'mat4f',
};

export class ShaderkitWGSLGenerator implements WgslGenerator {
  /** Used to track variable declarations with the `attribute` qualifier */
  #lastAttributeIdx = -1;
  #shaderType: 'vertex' | 'fragment' =
    'vertex' /* does not matter, will get overriden */;

  #attributes = new Map<number, AttributeInfo>();
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
      for (const decl of statement.declarations) {
        if (decl.qualifiers.includes('attribute')) {
          do {
            this.#lastAttributeIdx++;
          } while (this.#attributes.has(this.#lastAttributeIdx));

          this.#attributes.set(this.#lastAttributeIdx, {
            id: decl.id.name,
            paramId: this.uniqueId(decl.id.name),
            location: this.#lastAttributeIdx,
            type: this.generateTypeSpecifier(decl.typeSpecifier),
          });
          return '';
        }

        // TODO: Handle manual layout qualifiers (e.g. layout(location=0))
      }
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

      return `fn ${funcName}(${params}) {\n${body}\n}`;
    }

    if (statement.type === 'ExpressionStatement') {
      return this.generateExpression(statement.expression);
    }

    if (statement.type === 'PrecisionQualifierStatement') {
      // No-op
      return '';
    }

    // TOOD: Implement the logic to generate a statement
    throw new Error(`Cannot generate ${statement.type} statements yet.`);
  }

  generate(vertexCode: string, fragmentCode: string): WgslGeneratorResult {
    // Initializing
    this.#lastAttributeIdx = -1;

    const vertexAst = shaderkit.parse(vertexCode);
    const fragmentAst = shaderkit.parse(fragmentCode);

    let wgsl = `// Generated by degl

var<private> gl_Position: vec4<f32>;
var<private> gl_FragColor: vec4<f32>;`;

    this.#shaderType = 'vertex';
    for (const statement of vertexAst.body) {
      wgsl += this.generateStatement(statement) + '\n';
    }

    this.#shaderType = 'fragment';
    for (const statement of fragmentAst.body) {
      wgsl += this.generateStatement(statement) + '\n';
    }

    // Adding attribute proxies
    for (const attribute of this.#attributes.values()) {
      wgsl += `var<private> ${attribute.id}: ${attribute.type};\n`;
    }

    // Generating the real entry functions
    const attribParams = [...this.#attributes.values()]
      .map(
        (attribute) =>
          `@location(${attribute.location}) ${attribute.paramId}: ${attribute.type}`,
      )
      .join(', ');

    wgsl += `\

@vertex
fn ${this.uniqueId('vert_main')}(${attribParams}) -> @builtin(position) vec4f {
  ${[...this.#attributes.values()].map((attribute) => `${attribute.id} = ${attribute.paramId};`)}

  ${this.#fakeVertexMainId}();
  return gl_Position;
}

@fragment
fn ${this.uniqueId('frag_main')}() -> @location(0) vec4f {
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
    };
  }
}
