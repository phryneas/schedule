import { schedulableImplementationSignal } from "./internal.ts";
import { executeIterableSync } from "./syncScheduler.ts";
import type {
  SchedulableFunction,
  SchedulableIterable,
  SchedulableMarker,
} from "./types.ts";

/**
 * TODO docs
 */
/* Overload for inference */
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

/**
 * TODO docs
 */
/* Overload for manual specification of the different shapes, in case a method uses generics and/or overloads */
export function makeSchedulable<
  FullSignature extends SchedulableMarker<
    (...args: any[]) => SchedulableIterable<unknown>,
    (...args: any[]) => unknown,
    (...args: any[]) => Promise<unknown>
  >,
>(
  schedulableImplementation: FullSignature extends FullSignature[typeof schedulableImplementationSignal]["syncSignature"]
    ? FullSignature[typeof schedulableImplementationSignal]
    : never,
): FullSignature;

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
      return executeIterableSync(schedulableImplementation.apply(this, args));
    },
  };

  return Object.assign(schedulable[name]!, {
    [schedulableImplementationSignal]: schedulableImplementation,
  });
}
