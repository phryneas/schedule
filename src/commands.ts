import type { SchedulableIterable, ScheduleSignal } from "./types.ts";

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

export const execute = <Ret, Args extends Array<unknown>, ThisArg>(
  fn: (this: ThisArg, ...args: Args) => Ret,
  thisArg: ThisArg,
  args: Args,
  startImmediately = false,
): SchedulableIterable<Ret> => {
  return (function* executeCommand(): Generator<Command, Ret> {
    const result = yield {
      kind: "execute" as const,
      fn: fn as any,
      args,
      this: thisArg,
      startImmediately,
    };
    return result as Ret;
  })();
};

export const syncAware = <Ret, Args extends Array<unknown>, ThisArg>(options: {
  sync: (this: ThisArg, ...args: Args) => Ret;
  async: (this: ThisArg, ...args: Args) => Promise<Ret>;
  args: Args;
  this?: ThisArg;
  startImmediately?: boolean;
}): SchedulableIterable<Ret> => {
  return (function* executeCommand(): Generator<Command, Ret> {
    const result = yield {
      kind: "syncAware" as const,
      ...(options as any),
    };
    return result as Ret;
  })();
};
