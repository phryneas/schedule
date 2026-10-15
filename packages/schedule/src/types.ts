import type { Command } from "./commands.ts";
import type { schedulableImplementationSignal } from "./internal.ts";

export type SchedulableIterable<T> = Generator<Command, T>;

export interface SchedulableMarker<
  GeneratorSignature extends (...args: any[]) => SchedulableIterable<unknown>,
  SyncSignature extends (...args: any[]) => any,
  AsyncSignature extends (...args: any[]) => Promise<any>,
> {
  [schedulableImplementationSignal]: GeneratorSignature & {
    syncSignature?: SyncSignature;
    asyncSignature?: AsyncSignature;
  };
}

interface SchedulableImplementation<
  Ret,
  Args extends Array<unknown>,
  ThisArg,
> {
  (this: ThisArg, ...args: Args): SchedulableIterable<Ret>;
  syncSignature?: (this: ThisArg, ...args: Args) => Ret;
  asyncSignature?: (this: ThisArg, ...args: Args) => Promise<Ret>;
}

export interface SchedulableFunction<
  Ret,
  Args extends Array<unknown> = [],
  ThisArg = unknown,
> {
  (this: ThisArg, ...args: Args): Ret;
  [schedulableImplementationSignal]: SchedulableImplementation<Ret, Args, ThisArg>;
  command: SchedulableImplementation<Ret, Args, ThisArg>;
}

type MethodOf<This, Args extends unknown[], Ret> = {
  invoke(this: This, ...args: Args): Ret;
}["invoke"];

interface SchedulableMethodImplementation<ThisArg, Args extends unknown[], Ret>
  extends MethodOf<ThisArg, Args, SchedulableIterable<Ret>> {
  syncSignature?(this: ThisArg, ...args: Args): Ret;
  asyncSignature?(this: ThisArg, ...args: Args): Promise<Ret>;
}

interface SchedulableMethodSignature<ThisArg, Args extends unknown[], Ret>
  extends MethodOf<ThisArg, Args, Ret> {
  [schedulableImplementationSignal]: SchedulableMethodImplementation<ThisArg, Args, Ret>;
  command: SchedulableMethodImplementation<ThisArg, Args, Ret>;
}

/** Explicit signature for a non-generic, non-overloaded method. */
export type SchedulableMethod<Fn extends (this: any, ...args: any[]) => unknown> =
  Fn extends (this: infer ThisArg, ...args: infer Args) => infer Ret
    ? SchedulableMethodSignature<ThisArg, Args, Ret>
    : never;

export interface ScheduleSignal extends Pick<
  AbortSignal,
  "aborted" | "throwIfAborted"
> {
  shouldYield: boolean;
  bump: () => void;
}
