export class NotImplementedYetError extends Error {
  constructor(feature: string) {
    super(
      `Feature '${feature}' is not implemented yet. Please file an issue or help with the cause at https://github.com/software-mansion-labs/byegl 🥯🐶`,
    );

    // Set the prototype explicitly.
    Object.setPrototypeOf(this, NotImplementedYetError.prototype);
  }
}

export class ShaderCompilationError extends Error {
  constructor(
    public readonly cause: unknown,
    public readonly trace: unknown[],
  ) {
    let entries = trace.map((ancestor) => `- ${ancestor}`);

    // Showing only the root and leaf nodes.
    if (entries.length > 20) {
      entries = [...entries.slice(0, 11), '...', ...entries.slice(-10)];
    }

    super(
      `Compilation of the following tree failed:\n${entries.join('\n')}: ${
        cause && typeof cause === 'object' && 'message' in cause
          ? cause.message
          : cause
      }`,
    );

    // Set the prototype explicitly.
    Object.setPrototypeOf(this, ShaderCompilationError.prototype);
  }

  appendToTrace(ancestor: unknown): ShaderCompilationError {
    const newTrace = [ancestor, ...this.trace];

    return new ShaderCompilationError(this.cause, newTrace);
  }
}
