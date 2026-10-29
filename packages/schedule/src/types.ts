import type { Command } from "./commands.ts";

export type SchedulableIterable<ReturnValue, EmittedValue = never> =
  Generator<Command<EmittedValue>, ReturnValue>;

export interface SchedulableMarker<
  GeneratorSignature extends (...args: any[]) => SchedulableIterable<unknown, unknown>,
> {
  schedulable: GeneratorSignature;
}

type SchedulableImplementation<
  Ret,
  Args extends Array<unknown>,
  ThisArg,
  EmittedValue,
> = (this: ThisArg, ...args: Args) => SchedulableIterable<Ret, EmittedValue>;

export interface SchedulableFunction<
  Ret,
  Args extends Array<unknown> = [],
  ThisArg = unknown,
  EmittedValue = never,
> {
  (this: ThisArg, ...args: Args): Ret;
  schedulable: SchedulableImplementation<Ret, Args, ThisArg, EmittedValue>;
}

type MethodOf<This, Args extends unknown[], Ret> = {
  invoke(this: This, ...args: Args): Ret;
}["invoke"];

type SchedulableMethodImplementation<ThisArg, Args extends unknown[], Ret, EmittedValue> =
  MethodOf<ThisArg, Args, SchedulableIterable<Ret, EmittedValue>>;

interface SchedulableMethodSignature<ThisArg, Args extends unknown[], Ret, EmittedValue>
  extends MethodOf<ThisArg, Args, Ret> {
  schedulable: SchedulableMethodImplementation<ThisArg, Args, Ret, EmittedValue>;
}

/** Explicit signature for a non-generic, non-overloaded method. */
export type SchedulableMethod<Fn extends (this: any, ...args: any[]) => unknown, EmittedValue = never> =
  Fn extends (this: infer ThisArg, ...args: infer Args) => infer Ret
    ? SchedulableMethodSignature<ThisArg, Args, Ret, EmittedValue>
    : never;

export interface ScheduleSignal extends Pick<
  AbortSignal,
  "aborted" | "throwIfAborted" | "addEventListener" | "removeEventListener"
> {
  shouldYield: boolean;
  bump: () => void;
}
