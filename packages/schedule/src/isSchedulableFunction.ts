import { schedulableImplementationSymbol } from "./internal.ts";
import type { SchedulableFunction } from "./types.ts";

export function isSchedulableFunction<Ret = unknown, Args extends Array<unknown> = any[], EmittedValue = unknown>(
  fn: unknown,
): fn is SchedulableFunction<Ret, Args, unknown, EmittedValue> {
  return typeof fn === "function" && schedulableImplementationSymbol in fn;
}
