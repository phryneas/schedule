import { asSchedulable } from "./asSchedulable.ts";
import { syncScheduler } from "./syncScheduler.ts";
import type { SchedulableFunction, SchedulableIterable } from "./types.ts";

export function makeSchedulable<
  Ret,
  Args extends Array<unknown> = [],
  ThisArg = unknown,
>(
  schedulableImplementation: (
    this: ThisArg,
    ...args: Args
  ) => SchedulableIterable<Ret>,
): SchedulableFunction<Ret, Args, ThisArg> {
  const name = schedulableImplementation.name || "schedulableFunction";
  const schedulable = {
    [name](this: ThisArg, ...args: Args) {
      return syncScheduler(schedulableImplementation.apply(this, args));
    },
  };

  asSchedulable(schedulable[name]!, schedulableImplementation);
  return schedulable[name];
}
