import { schedulableImplementationSignal } from "./internal.ts";
import type { SchedulableFunction } from "./types.ts";

export function isSchedulableFunction<Ret, Args extends Array<unknown>>(
  fn: unknown,
): fn is SchedulableFunction<Ret, Args> {
  return typeof fn === "function" && schedulableImplementationSignal in fn;
}
