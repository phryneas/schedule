// A mutable boolean avoids narrowing that changes the callable's original
// signatures; direct guards demonstrate the errors this prevents.
import type { SchedulableFunction } from "../../schedule/src/types.ts";
import { isSchedulableFunction } from "../../schedule/src/index.ts";

declare const memoized: SchedulableFunction<number, [value: number]>;
if (!isSchedulableFunction(memoized)) {
  // @ts-expect-error The transformed function always has the marker: fallback is never.
  memoized(1);
}

declare const coerce: ((value: unknown) => unknown)
  | SchedulableFunction<unknown, [value: unknown, hideSuggestions?: boolean]>;
if (!isSchedulableFunction(coerce)) {
  coerce(1, true);
}

let scheduled = isSchedulableFunction(memoized);
if (!scheduled) memoized(1);
let scheduledCoerce = isSchedulableFunction(coerce);
if (!scheduledCoerce) coerce(1, true);
