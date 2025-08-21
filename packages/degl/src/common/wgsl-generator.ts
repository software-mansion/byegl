export interface WgslGenerator {
  generate(vertexCode: string, fragmentCode: string): string;
}
