import type { Command } from "./commands.ts";

export type SchedulableIterable<T> = Generator<Command, T>;

export interface SchedulableMarker<
  GeneratorSignature extends (...args: any[]) => SchedulableIterable<unknown>,
> {
  schedulable: GeneratorSignature;
}

type SchedulableImplementation<
  Ret,
  Args extends Array<unknown>,
  ThisArg,
> = (this: ThisArg, ...args: Args) => SchedulableIterable<Ret>;

export interface SchedulableFunction<
  Ret,
  Args extends Array<unknown> = [],
  ThisArg = unknown,
> {
  (this: ThisArg, ...args: Args): Ret;
  schedulable: SchedulableImplementation<Ret, Args, ThisArg>;
}

type MethodOf<This, Args extends unknown[], Ret> = {
  invoke(this: This, ...args: Args): Ret;
}["invoke"];

type SchedulableMethodImplementation<ThisArg, Args extends unknown[], Ret> =
  MethodOf<ThisArg, Args, SchedulableIterable<Ret>>;

interface SchedulableMethodSignature<ThisArg, Args extends unknown[], Ret>
  extends MethodOf<ThisArg, Args, Ret> {
  schedulable: SchedulableMethodImplementation<ThisArg, Args, Ret>;
}

/** Explicit signature for a non-generic, non-overloaded method. */
export type SchedulableMethod<Fn extends (this: any, ...args: any[]) => unknown> =
  Fn extends (this: infer ThisArg, ...args: infer Args) => infer Ret
    ? SchedulableMethodSignature<ThisArg, Args, Ret>
    : never;

export interface ScheduleSignal extends Pick<
  AbortSignal,
  "aborted" | "throwIfAborted" | "addEventListener" | "removeEventListener"
> {
  shouldYield: boolean;
  bump: () => void;
}
