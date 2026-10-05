export class HowToError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "HowToError";
    this.code = code;
    this.exitCode = options.exitCode || 1;
    this.status = options.status;
    this.details = options.details;
  }
}

export function assert(condition, code, message, options) {
  if (!condition) throw new HowToError(code, message, options);
}
