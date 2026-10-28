import type {
  SchedulableIterable,
  SchedulableMarker,
  ScheduleSignal,
} from "./types.ts";
import { schedulableImplementationSymbol } from "./internal.ts";
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

export function sync<
  Fn extends SchedulableMarker<(...args: any[]) => any, any, any>,
>(
  fn: Fn,
): NonNullable<Fn[typeof schedulableImplementationSymbol]["syncSignature"]> {
  return function (this: any) {
    return executeIterableSync(
      fn[schedulableImplementationSymbol].apply(this, arguments as any),
    );
  };
}

export function executeIterableSync<T>(iterable: SchedulableIterable<T>): T {
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
          ? executeIterableSync(fn[schedulableImplementationSymbol].apply(thisArg, args))
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
