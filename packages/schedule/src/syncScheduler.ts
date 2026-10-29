import type {
  SchedulableIterable,
  ScheduleSignal,
} from "./types.ts";
import { getSchedulableImplementation } from "./internal.ts";
import { isSchedulableFunction } from "./isSchedulableFunction.ts";

export const syncSignal: ScheduleSignal = {
  shouldYield: false,
  aborted: false,
  addEventListener() {},
  removeEventListener() {},
  throwIfAborted() {
    /** */
  },
  bump() {
    /** */
  },
};

export function sync<T, EmittedValue = never>(
  iterable: SchedulableIterable<T, EmittedValue>,
  { onValue }: { onValue?: (value: EmittedValue) => void } = {},
): T {
  return executeIterableSync(iterable, onValue);
}

export function executeIterableSync<T, EmittedValue = never>(
  iterable: SchedulableIterable<T, EmittedValue>,
  onValue?: (value: EmittedValue) => void,
): T {
  const iterator = iterable[Symbol.iterator]();
  let nextArg: unknown;
  let throwing = false;
  do {
    const result = throwing ? iterator.throw(nextArg) : iterator.next(nextArg);
    throwing = false;
    nextArg = undefined;
    if (result.done) {
      return result.value;
    }
    try {
      switch (result.value.kind) {
      case "emit": {
        onValue?.(result.value.value);
        break;
      }
      case "getSignal": {
        nextArg = syncSignal;
        break;
      }
      case "yield": {
        // A defined resumption value completes the reusable yield command.
        nextArg = null;
        break;
      }
      case "execute": {
        const { fn, args, this: thisArg } = result.value;
        nextArg = isSchedulableFunction(fn)
          ? executeIterableSync(getSchedulableImplementation<EmittedValue>(fn).apply(thisArg, args), onValue)
          : fn.apply(thisArg, args);
        break;
      }
      case "syncAware": {
        const { sync, args, this: thisArg } = result.value;
        nextArg = sync.apply(thisArg, args);
        break;
      }
      }
    } catch (error) {
      nextArg = error;
      throwing = true;
    }
    // eslint-disable-next-line no-constant-condition
  } while (true);
}
