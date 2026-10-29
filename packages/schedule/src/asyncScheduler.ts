import { getSchedulableImplementation } from "./internal.ts";
import { isSchedulableFunction } from "./isSchedulableFunction.ts";
import type { Command } from "./commands.ts";
import type {
  SchedulableIterable,
  ScheduleSignal,
} from "./types.ts";

interface AsyncOptions<EmittedValue> {
  signal?: AbortSignal | ScheduleSignal;
  startImmediately?: boolean;
  onValue?: (value: EmittedValue) => void;
}

export async function async<T, EmittedValue = never>(
  iterable: SchedulableIterable<T, EmittedValue>,
  { signal, startImmediately, onValue }: AsyncOptions<EmittedValue> = {},
): Promise<Awaited<T>> {
  if (!startImmediately) {
    await new Promise<void>(schedule);
  }
  signal?.throwIfAborted();
  return executeIterableAsync(iterable, signal, onValue);
}

async function executeIterableAsync<T, EmittedValue>(
  iterable: SchedulableIterable<T, EmittedValue>,
  abortSignal?: AbortSignal | ScheduleSignal,
  onValue?: (value: EmittedValue) => void,
): Promise<Awaited<T>> {
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
      addEventListener:
        abortSignal?.addEventListener.bind(abortSignal) ?? (() => {}),
      removeEventListener:
        abortSignal?.removeEventListener.bind(abortSignal) ?? (() => {}),
      get shouldYield() {
        abortSignal?.throwIfAborted();
        return performance.now() >= nextYield;
      },
      bump() {
        nextYield = performance.now() + 16;
      },
    };
  }

  const parents: SchedulableIterable<unknown, EmittedValue>[] = [];
  let iterator: SchedulableIterable<unknown, EmittedValue> = iterable[Symbol.iterator]();
  let initialResult: IteratorResult<Command<EmittedValue>, unknown> | undefined;
  let nextArg: unknown;
  let throwing = false;
  do {
    checkAborted();
    let result: IteratorResult<Command<EmittedValue>, unknown>;
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
    checkAborted();
    initialResult = undefined;
    throwing = false;
    nextArg = undefined;
    if (result.done) {
      const parent = parents.pop();
      if (!parent) return result.value as Awaited<T>;
      iterator = parent;
      // Returning a promise is distinct from explicitly awaiting a syncAware command.
      nextArg = result.value;
      continue;
    }
    try {
      switch (result.value.kind) {
        case "emit": {
          onValue?.(result.value.value);
          continue;
        }
        case "getSignal": {
          nextArg = scheduleSignal;
          continue;
        }
        case "yield": {
          await new Promise<void>(schedule);
          checkAborted();
          scheduleSignal.bump();
          // A defined resumption value completes the reusable yield command.
          nextArg = null;
          continue;
        }
        case "execute": {
          const { fn, args, this: thisArg, startImmediately } = result.value;
          if (!startImmediately && scheduleSignal.shouldYield) {
            await new Promise<void>(schedule);
            checkAborted();
            scheduleSignal.bump();
          }
          if (isSchedulableFunction(fn)) {
            const child = getSchedulableImplementation<EmittedValue>(fn)
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
            checkAborted();
            scheduleSignal.bump();
          }

          const value = async.apply(thisArg, args);
          if (scheduleSignal.aborted) {
            Promise.resolve(value).catch(() => {});
            checkAborted();
          }
          if (!abortSignal) {
            nextArg = await value;
          } else {
            nextArg = await new Promise<unknown>((resolve, reject) => {
              // Wake the scheduler so its terminal cancellation check closes the frames.
              abortSignal.addEventListener("abort", reject, { once: true });
              // Keep observing the operation even if cancellation wins the race.
              Promise.resolve(value)
                .then(resolve, reject)
                .finally(() =>
                  abortSignal.removeEventListener("abort", reject),
                );
            });
          }

          continue;
        }
      }
    } catch (error) {
      nextArg = error;
      throwing = true;
    }
  } while (true);

  function checkAborted() {
    if (scheduleSignal.aborted) {
      for (const frame of [iterator, ...parents.reverse()]) {
        try {
          while (!frame.return(undefined).done) {}
        } catch {
          // Finish closing the other frames even if cleanup throws.
        }
      }
      return scheduleSignal.throwIfAborted();
    }
  }
}

function schedule(fn: () => void) {
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = () => {
    port1.close?.();
    fn();
  };
  port2.postMessage(null);
}
