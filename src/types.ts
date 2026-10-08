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

export interface SchedulableFunction<
  Ret,
  Args extends Array<unknown> = [],
  ThisArg = unknown,
> extends SchedulableMarker<
  (this: ThisArg, ...args: Args) => SchedulableIterable<Ret>,
  (this: ThisArg, ...args: Args) => Ret,
  (this: ThisArg, ...args: Args) => Promise<Ret>
> {
  (this: ThisArg, ...args: Args): Ret;
}
export interface ScheduleSignal extends Pick<
  AbortSignal,
  "aborted" | "throwIfAborted"
> {
  shouldYield: boolean;
  bump: () => void;
}
