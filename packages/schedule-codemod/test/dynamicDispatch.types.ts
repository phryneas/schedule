// A mutable boolean avoids narrowing that changes the callable's original
// signatures; direct guards demonstrate the errors this prevents.
import type { SchedulableFunction } from "../../schedule/src/types.ts";
import { schedulableImplementationSignal } from "../../schedule/src/index.ts";

declare const memoized: SchedulableFunction<number, [value: number]>;
if (!(schedulableImplementationSignal in memoized)) {
  // @ts-expect-error The transformed function always has the marker: fallback is never.
  memoized(1);
}

declare const coerce: ((value: unknown) => unknown)
  | SchedulableFunction<unknown, [value: unknown, hideSuggestions?: boolean]>;
if (!(schedulableImplementationSignal in coerce)) {
  // @ts-expect-error Narrowing removes the signature accepting hideSuggestions.
  coerce(1, true);
}

let scheduled = schedulableImplementationSignal in memoized;
if (!scheduled) memoized(1);
let scheduledCoerce = schedulableImplementationSignal in coerce;
if (!scheduledCoerce) coerce(1, true);
