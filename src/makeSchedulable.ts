import { schedulableImplementationSignal } from "./internal.ts";
import { syncScheduler } from "./syncScheduler.ts";
import type {
  SchedulableFunction,
  SchedulableIterable,
  SchedulableMarker,
} from "./types.ts";

export function makeSchedulable<
  GeneratorSignature extends (...args: any[]) => SchedulableIterable<unknown>,
  SyncSignature extends (...args: any[]) => any,
  AsyncSignature extends (...args: any[]) => Promise<any>,
>(
  schedulableImplementation: GeneratorSignature,
): SyncSignature &
  SchedulableMarker<GeneratorSignature, SyncSignature, AsyncSignature>;

export function makeSchedulable<
  Ret,
  Args extends Array<unknown> = [],
  ThisArg = unknown,
>(
  schedulableImplementation: (
    this: ThisArg,
    ...args: Args
  ) => SchedulableIterable<Ret>,
): SchedulableFunction<Ret, Args, ThisArg>;

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

  return Object.assign(schedulable[name]!, {
    [schedulableImplementationSignal]: schedulableImplementation,
  });
}
