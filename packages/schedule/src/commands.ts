import type {
  SchedulableIterable,
  SchedulableMarker,
  ScheduleSignal,
} from "./types.ts";
import type { schedulableImplementationSignal } from "./internal.ts";
import type {
  HasMultipleSignatures,
  MapResults,
  TypeFunction,
} from "./mapResults.ts";

interface ToSchedulable extends TypeFunction {
  readonly output: SchedulableIterable<this["input"]>;
}

export type Command =
  | { kind: "getSignal" }
  | { kind: "yield" }
  | {
      kind: "execute";
      fn: (...args: Array<unknown>) => unknown;
      args: Array<unknown>;
      this?: unknown;
      startImmediately?: boolean;
    }
  | {
      kind: "syncAware";
      sync: (...args: Array<unknown>) => unknown;
      async: (...args: Array<unknown>) => unknown;
      args: Array<unknown>;
      this?: unknown;
      startImmediately?: boolean;
    };

export function* yieldNow(): SchedulableIterable<void> {
  yield { kind: "yield" };
}

export function* getSignal(): SchedulableIterable<ScheduleSignal> {
  return (yield { kind: "getSignal" }) as ScheduleSignal;
}

export function execute<Fn extends (...args: any[]) => unknown>(
  fn: HasMultipleSignatures<Fn> extends true
    ? Fn
    : Fn extends SchedulableMarker<
        (...args: any[]) => SchedulableIterable<unknown>,
        any,
        any
      > ? Fn : never,
  startImmediately?: boolean,
): Fn extends SchedulableMarker<
  (...args: any[]) => SchedulableIterable<unknown>,
  any,
  any
>
  ? Fn[typeof schedulableImplementationSignal]
  : MapResults<Fn, ToSchedulable>;
export function execute<Ret, Args extends Array<unknown>, ThisArg>(
  fn: (this: ThisArg, ...args: Args) => Ret,
  startImmediately?: boolean,
): (this: ThisArg, ...args: Args) => SchedulableIterable<Ret>;
export function execute(
  fn: Function,
  startImmediately?: boolean,
): (this: unknown, ...args: any[]) => SchedulableIterable<any>;
export function execute(
  fn: Function,
  startImmediately = false,
) {
  return function* executeCommand(
    this: unknown,
    ...args: unknown[]
  ): SchedulableIterable<unknown> {
    const result = yield {
      kind: "execute" as const,
      fn: fn as any,
      args,
      this: this,
      startImmediately,
    };
    return result;
  };
}

export const syncAware = <Ret, Args extends Array<unknown>, ThisArg>(options: {
  sync: (this: ThisArg, ...args: Args) => Ret;
  async: (this: ThisArg, ...args: Args) => Promise<Ret>;
  startImmediately?: boolean;
}): (this: ThisArg, ...args: Args) => SchedulableIterable<Ret> => {
  return function* executeCommand(this: ThisArg, ...args: Args): Generator<Command, Ret> {
    const result = yield {
      kind: "syncAware" as const,
      ...(options as any),
      args,
      this: this,
    };
    return result as Ret;
  };
};
