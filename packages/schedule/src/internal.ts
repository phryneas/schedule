import type { SchedulableIterable } from "./types.ts";

export const schedulableImplementationSymbol = Symbol();

// Only call after identifying a function created by makeSchedulable.
export function getSchedulableImplementation<EmittedValue = unknown>(fn: Function) {
  return (fn as unknown as {
    [schedulableImplementationSymbol]: (...args: any[]) => SchedulableIterable<unknown, EmittedValue>;
  })[schedulableImplementationSymbol];
}
