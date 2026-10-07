import { schedulableImplementationSignal } from "./internal.ts";
import { syncScheduler } from "./syncScheduler.ts";
import type { SchedulableIterable, SchedulableFunction } from "./types.ts";

export function asSchedulable<Ret, Args extends Array<unknown>, ThisArg>(
  fn: (this: ThisArg, ...args: Args) => Ret,
  schedulableImplementation: (
    this: ThisArg,
    ...args: Args
  ) => SchedulableIterable<Ret>,
): asserts fn is SchedulableFunction<Ret, Args, ThisArg> {
  Object.defineProperty(fn, schedulableImplementationSignal, {
    value: schedulableImplementation,
    enumerable: false,
  });
  Object.defineProperty(fn, "sync", {
    value(this: ThisArg, ...args: Args) {
      return syncScheduler(schedulableImplementation.apply(this, args));
    },
    enumerable: false,
  });
}
