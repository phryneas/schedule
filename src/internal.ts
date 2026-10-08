import type { ScheduleSignal } from "./types.ts";

export const schedulableImplementationSignal = Symbol();

export const context = {
  signal: undefined as ScheduleSignal | undefined,
  inSyncAware: false,
};
