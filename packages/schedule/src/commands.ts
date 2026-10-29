import type {
  SchedulableIterable,
  SchedulableMarker,
  ScheduleSignal,
} from "./types.ts";
import type { schedulableImplementationSymbol } from "./internal.ts";
import { SingleCommand } from "./singleCommand.ts";
import { ReusableCommand } from "./reusableCommand.ts";
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

export const yieldNow: SchedulableIterable<void> = new ReusableCommand<void>(
  { kind: "yield" },
  { done: true, value: undefined },
);
export const getSignal: SchedulableIterable<ScheduleSignal> =
  new ReusableCommand<ScheduleSignal>({ kind: "getSignal" });

export function execute<Fn extends (...args: any[]) => unknown>(
  fn: HasMultipleSignatures<Fn> extends true
    ? Fn
    : Fn extends SchedulableMarker<
          (...args: any[]) => SchedulableIterable<unknown>
        >
      ? Fn
      : never,
  startImmediately?: boolean,
): Fn extends SchedulableMarker<
  (...args: any[]) => SchedulableIterable<unknown>
>
  ? Fn[typeof schedulableImplementationSymbol]
  : MapResults<Fn, ToSchedulable>;
export function execute<Ret, Args extends Array<unknown>, ThisArg>(
  fn: (this: ThisArg, ...args: Args) => Ret,
  startImmediately?: boolean,
): (this: ThisArg, ...args: Args) => SchedulableIterable<Ret>;
export function execute(
  fn: Function,
  startImmediately?: boolean,
): (this: unknown, ...args: any[]) => SchedulableIterable<any>;
export function execute(fn: Function, startImmediately = false) {
  return function executeCommand(
    this: unknown,
    ...args: unknown[]
  ): SchedulableIterable<unknown> {
    return new SingleCommand({
      kind: "execute",
      fn: fn as any,
      args,
      this: this,
      startImmediately,
    });
  };
}

export const syncAware = <Ret, Args extends Array<unknown>, ThisArg>(options: {
  sync: (this: ThisArg, ...args: Args) => Ret;
  async: (this: ThisArg, ...args: Args) => Promise<Ret>;
  startImmediately?: boolean;
}): ((this: ThisArg, ...args: Args) => SchedulableIterable<Ret>) => {
  return function executeCommand(
    this: ThisArg,
    ...args: Args
  ): SchedulableIterable<Ret> {
    return new SingleCommand<Ret>({
      kind: "syncAware" as const,
      ...(options as any),
      args,
      this: this,
    });
  };
};
