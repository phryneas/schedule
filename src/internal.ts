import type { ScheduleSignal } from "./types.ts";

export const schedulableImplementationSignal = Symbol();

export const context = {
  signal: null as ScheduleSignal | null,
};
