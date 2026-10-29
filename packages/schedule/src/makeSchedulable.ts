import { schedulableImplementationSymbol } from "./internal.ts";
import { executeIterableSync } from "./syncScheduler.ts";
import { execute } from "./commands.ts";
import type { Command } from "./commands.ts";
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
  YieldedCommand extends Command<unknown>,
  Ret,
  Args extends Array<unknown>,
  ThisArg,
>(
  schedulableImplementation: (
    this: ThisArg,
    ...args: Args
  ) => Generator<YieldedCommand, Ret>,
): SchedulableFunction<Ret, Args, ThisArg, Extract<YieldedCommand, { kind: "emit" }>["value"]>;

/* Overload for explicit return, argument, receiver, and emission types. */
export function makeSchedulable<
  Ret,
  Args extends Array<unknown> = [],
  ThisArg = unknown,
  EmittedValue = never,
>(
  schedulableImplementation: (
    this: ThisArg,
    ...args: Args
  ) => SchedulableIterable<Ret, EmittedValue>,
): SchedulableFunction<Ret, Args, ThisArg, EmittedValue>;

/**
 * TODO docs
 */
/* Overload for manual specification of the different shapes, in case a method uses generics and/or overloads */
export function makeSchedulable<
  FullSignature extends SchedulableMarker<
    (...args: any[]) => SchedulableIterable<unknown, unknown>
  > & ((...args: any[]) => unknown),
>(
  schedulableImplementation: FullSignature["schedulable"],
): FullSignature;

export function makeSchedulable<
  Ret,
  Args extends Array<unknown> = [],
  ThisArg = unknown,
  EmittedValue = never,
>(
  schedulableImplementation: (
    this: ThisArg,
    ...args: Args
  ) => SchedulableIterable<Ret, EmittedValue>,
): SchedulableFunction<Ret, Args, ThisArg, EmittedValue> {
  const name = schedulableImplementation.name || "schedulableFunction";
  const schedulable = {
    [name](this: ThisArg, ...args: Args) {
      return executeIterableSync(schedulableImplementation.apply(this, args));
    },
  };

  const result = Object.assign(schedulable[name]!, {
    [schedulableImplementationSymbol]: schedulableImplementation,
    schedulable: execute(schedulable[name]!),
  });
  Object.defineProperty(result, "schedulable", { enumerable: false });
  return result;
}
