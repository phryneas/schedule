import type {
  SchedulableFunction,
  SchedulableIterable,
  SchedulableMarker,
  ScheduleSignal,
} from "./types.ts";
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

export function sync<
  Fn extends SchedulableMarker<(...args: any[]) => any, any, any>,
>(
  fn: Fn,
): NonNullable<Fn[typeof schedulableImplementationSignal]["syncSignature"]> {
  return function (this: any) {
    return executeIterableSync(
      fn[schedulableImplementationSignal].apply(this, arguments as any),
    );
  };
}

export function executeIterableSync<T>(iterable: SchedulableIterable<T>): T {
  if (context.signal !== undefined || context.inSyncAware) {
    throw new Error(
      "Cannot start a scheduler inside a scheduler. Use execute() to compose schedulable functions.",
    );
  }
  try {
    context.signal = syncSignal;
    return syncSchedulerInternal(iterable);
  } finally {
    context.signal = undefined;
  }
}

function syncSchedulerInternal<T>(iterable: SchedulableIterable<T>): T {
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
          ? syncSchedulerInternal(fn[schedulableImplementationSignal](...args))
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
}
