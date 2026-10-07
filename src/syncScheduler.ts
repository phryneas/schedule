import type { SchedulableIterable, ScheduleSignal } from "./types.ts";
import { context, schedulableImplementationSignal } from "./internal.ts";
import { isSchedulableFunction } from "./isSchedulableFunction.ts";

export const syncSignal: ScheduleSignal = {
  shouldYield: false,
  aborted: false,
  throwIfAborted() {
    /** */
  },
  bump() {
    /** */
  },
};

export function syncScheduler<T>(iterable: SchedulableIterable<T>): T {
  const previousSignal = context.signal;
  try {
    context.signal = syncSignal;
    const iterator = iterable[Symbol.iterator]();
    let nextArg: unknown;
    do {
      const result = iterator.next(nextArg);
      nextArg = undefined;
      if (result.done) {
        return result.value;
      }
      switch (result.value.kind) {
        case "yield": {
          break;
        }
        case "execute": {
          const { fn, args, this: thisArg } = result.value;
          nextArg = isSchedulableFunction(fn)
            ? syncScheduler(fn[schedulableImplementationSignal](...args))
            : fn.apply(thisArg, args);
          break;
        }
        case "syncAware": {
          const { sync, args, this: thisArg } = result.value;
          nextArg = sync.apply(thisArg, args);
          break;
        }
      }
      // eslint-disable-next-line no-constant-condition
    } while (true);
  } finally {
    context.signal = previousSignal;
  }
}
