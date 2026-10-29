import type { SchedulableIterable } from "./types.ts";

export const schedulableImplementationSymbol = Symbol();

// Only call after identifying a function created by makeSchedulable.
export function getSchedulableImplementation(fn: Function) {
  return (fn as unknown as {
    [schedulableImplementationSymbol]: (...args: any[]) => SchedulableIterable<unknown>;
  })[schedulableImplementationSymbol];
}
