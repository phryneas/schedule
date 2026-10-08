import type { ScheduleSignal } from "./types.ts";
import { context } from "./internal.ts";

export function getSignal(): ScheduleSignal {
  const returnedSignal = context.signal;
  if (returnedSignal === undefined) {
    throw new Error(
      "getSignal() must be called during synchronous scheduler execution. Capture the signal before awaiting.",
    );
  }
  returnedSignal.throwIfAborted();
  return returnedSignal;
}
