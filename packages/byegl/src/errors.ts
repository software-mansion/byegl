export class NotImplementedYetError extends Error {
  constructor(feature: string) {
    super(
      `Feature '${feature}' is not implemented yet. Please file an issue or help with the cause at https://github.com/software-mansion-labs/byegl 🥯🐶`,
    );

    // Set the prototype explicitly.
    Object.setPrototypeOf(this, NotImplementedYetError.prototype);
  }
}
