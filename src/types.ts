import type { Command } from "./commands.ts";
import type { schedulableImplementationSignal } from "./internal.ts";

export type SchedulableIterable<T> = Generator<Command, T>;
export interface SchedulableFunction<
  Ret,
  Args extends Array<unknown> = [],
  ThisArg = unknown,
> {
  (this: ThisArg, ...args: Args): Ret;
  sync: (this: ThisArg, ...args: Args) => Ret;
  [schedulableImplementationSignal]: (
    this: ThisArg,
    ...args: Args
  ) => SchedulableIterable<Ret>;
}

export interface ScheduleSignal extends Pick<
  AbortSignal,
  "aborted" | "throwIfAborted"
> {
  shouldYield: boolean;
  bump: () => void;
}
