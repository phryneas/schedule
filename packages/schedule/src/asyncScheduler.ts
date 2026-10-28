import { schedulableImplementationSymbol } from "./internal.ts";
import { isSchedulableFunction } from "./isSchedulableFunction.ts";
import type { Command } from "./commands.ts";
import type {
  SchedulableIterable,
  SchedulableMarker,
  ScheduleSignal,
} from "./types.ts";

export function async<
  Fn extends SchedulableMarker<(...args: any[]) => any, any, any>,
>(
  fn: Fn,
  {
    signal,
    startImmediately,
  }: {
    signal?: AbortSignal | ScheduleSignal;
    startImmediately?: boolean;
  } = {},
): NonNullable<Fn[typeof schedulableImplementationSymbol]["asyncSignature"]> {
  return async function (this: any) {
    if (!startImmediately) {
      await new Promise<void>(schedule);
    }
    return executeIterableAsync(
      fn[schedulableImplementationSymbol].apply(this, arguments as any),
      signal,
    );
  };
}

async function executeIterableAsync(
  iterable: SchedulableIterable<unknown>,
  abortSignal?: AbortSignal | ScheduleSignal,
): Promise<unknown> {
  let scheduleSignal: ScheduleSignal;
  if (abortSignal && "shouldYield" in abortSignal) {
    scheduleSignal = abortSignal;
  } else {
    let nextYield = performance.now() + 16;
    scheduleSignal = {
      get aborted() {
        return abortSignal?.aborted ?? false;
      },
      throwIfAborted() {
        abortSignal?.throwIfAborted();
      },
      get shouldYield() {
        abortSignal?.throwIfAborted();
        return performance.now() >= nextYield;
      },
      bump() {
        nextYield = performance.now() + 16;
      },
    };
  }

  const parents: SchedulableIterable<unknown>[] = [];
  let iterator = iterable[Symbol.iterator]();
  let initialResult: IteratorResult<Command, unknown> | undefined;
  let nextArg: unknown;
  let throwing = false;
  do {
    let result: IteratorResult<Command, unknown>;
    try {
      result =
        initialResult ??
        (throwing ? iterator.throw(nextArg) : iterator.next(nextArg));
    } catch (error) {
      const parent = parents.pop();
      if (!parent) throw error;
      iterator = parent;
      initialResult = undefined;
      nextArg = error;
      throwing = true;
      continue;
    }
    initialResult = undefined;
    throwing = false;
    nextArg = undefined;
    if (result.done) {
      const parent = parents.pop();
      if (!parent) return result.value;
      iterator = parent;
      // Returning a promise is distinct from explicitly awaiting a syncAware command.
      nextArg = result.value;
      continue;
    }
    try {
      switch (result.value.kind) {
        case "getSignal": {
          scheduleSignal.throwIfAborted();
          nextArg = scheduleSignal;
          continue;
        }
        case "yield": {
          await new Promise<void>(schedule);
          scheduleSignal.bump();
          // A defined resumption value completes the reusable yield command.
          nextArg = null;
          continue;
        }
        case "execute": {
          const { fn, args, this: thisArg, startImmediately } = result.value;
          if (!startImmediately && scheduleSignal.shouldYield) {
            await new Promise<void>(schedule);
            scheduleSignal.bump();
          }
          if (isSchedulableFunction(fn)) {
            const child = fn[schedulableImplementationSymbol]
              .apply(thisArg, args)
              [Symbol.iterator]();
            const first = child.next();
            if (first.done) {
              nextArg = first.value;
            } else {
              parents.push(iterator);
              iterator = child;
              initialResult = first;
            }
          } else {
            nextArg = fn.apply(thisArg, args);
          }
          continue;
        }
        case "syncAware": {
          const { async, args, this: thisArg, startImmediately } = result.value;
          if (!startImmediately && scheduleSignal.shouldYield) {
            await new Promise<void>(schedule);
            scheduleSignal.bump();
          }
          nextArg = await async.apply(thisArg, args);
          continue;
        }
      }
    } catch (error) {
      nextArg = error;
      throwing = true;
    }
  } while (true);
}

function schedule(fn: () => void) {
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = () => {
    port1.close?.();
    fn();
  };
  port2.postMessage(null);
}
