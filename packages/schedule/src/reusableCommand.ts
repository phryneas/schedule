import type { Command } from "./commands.ts";

export interface ReusableCommand<Ret> extends Generator<Command, Ret> {}

// The scheduler resumes these commands with a defined value. Unlike a normal
// iterator, each next(undefined) starts a new use; no per-use state is retained.
export class ReusableCommand<Ret> {
  private readonly request: IteratorYieldResult<Command>;
  private readonly completion: IteratorReturnResult<Ret> | undefined;

  constructor(
    command: Command,
    completion?: IteratorReturnResult<Ret>,
  ) {
    this.request = { done: false, value: command };
    this.completion = completion;
  }

  next(value?: Ret): IteratorResult<Command, Ret> {
    return value === undefined
      ? this.request
      : this.completion ?? { done: true, value };
  }

  throw(error: unknown): never {
    throw error;
  }

  return(value: Ret): IteratorReturnResult<Ret> {
    return { done: true, value };
  }

  [Symbol.iterator]() {
    return this;
  }
}

Object.setPrototypeOf(
  ReusableCommand.prototype,
  Object.getPrototypeOf(Object.getPrototypeOf((function* () {})())),
);
