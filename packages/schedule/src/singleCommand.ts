import type { Command } from "./commands.ts";

// The remaining Generator methods are inherited from the native prototype below.
export interface SingleCommand<Ret> extends Generator<Command, Ret> {}

export class SingleCommand<Ret> {
  private state = 0;
  protected command: Command | undefined;

  constructor(command: Command) {
    this.command = command;
  }

  next(value?: Ret): IteratorResult<Command, Ret> {
    if (this.state === 0) {
      this.state = 1;
      const command = this.command!;
      this.command = undefined;
      return { value: command, done: false };
    }
    if (this.state === 1) {
      this.state = 2;
      return { value: value!, done: true };
    }
    // Like a completed native generator, subsequent calls return undefined.
    return { value: undefined!, done: true };
  }

  throw(error: unknown): never {
    this.state = 2;
    this.command = undefined;
    throw error;
  }

  return(value: Ret): IteratorResult<Command, Ret> {
    this.state = 2;
    this.command = undefined;
    return { value, done: true };
  }

  [Symbol.iterator]() {
    return this;
  }
}

// Preserve the helpers supported by native generators in this environment,
// without requiring a global Iterator constructor.
Object.setPrototypeOf(
  SingleCommand.prototype,
  Object.getPrototypeOf(Object.getPrototypeOf((function* () {})())),
);
