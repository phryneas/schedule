import type { ScheduleSignal } from "./types.ts";
import { context } from "./internal.ts";
import { syncSignal } from "./syncScheduler.ts";

export function getSignal(): ScheduleSignal {
  const returnedSignal = context.signal ?? syncSignal;
  returnedSignal.throwIfAborted();
  return returnedSignal;
}
