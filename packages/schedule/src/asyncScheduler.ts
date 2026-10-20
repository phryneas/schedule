import { schedulableImplementationSignal } from "./internal.ts";
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
  signal?: AbortSignal | ScheduleSignal,
): NonNullable<Fn[typeof schedulableImplementationSignal]["asyncSignature"]> {
  return function (this: any) {
    return executeIterableAsync(
      fn[schedulableImplementationSignal].apply(this, arguments as any),
      signal,
    );
  };
}

function executeIterableAsync<T>(
  iterable: SchedulableIterable<T>,
  abortSignal?: AbortSignal | ScheduleSignal,
  initialResult?: IteratorResult<Command, T>,
): Promise<T> {
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

  let continueLoop = () => {
    /* */
  };
  return new Promise<T>((resolve, reject) => {
    const mainLoop = iterate();
    continueLoop = () => {
      mainLoop
        .next()
        .then((result) => {
          if (result.done) {
            resolve(result.value);
          }
        })
        .catch(reject);
    };
    continueLoop();
  });

  async function* iterate(): AsyncGenerator<void, T> {
    const iterator = initialResult ? iterable : iterable[Symbol.iterator]();
    let nextArg: unknown;
    let throwing = false;
    do {
      const result: IteratorResult<Command, T> = initialResult ?? (throwing ? iterator.throw(nextArg) : iterator.next(nextArg));
      initialResult = undefined;
      throwing = false;
      nextArg = undefined;
      if (result.done) {
        return result.value as Awaited<T>;
      }
      try {
        switch (result.value.kind) {
        case "getSignal": {
          scheduleSignal.throwIfAborted();
          nextArg = scheduleSignal;
          continue;
        }
        case "yield": {
          schedule(continueLoop);
          yield;
          scheduleSignal.bump();
          // A defined resumption value completes the reusable yield command.
          nextArg = null;
          continue;
        }
        case "execute": {
          const { fn, args, this: thisArg, startImmediately } = result.value;
          if (!startImmediately && scheduleSignal.shouldYield) {
            schedule(continueLoop);
            yield;
            scheduleSignal.bump();
          }
          if (isSchedulableFunction(fn)) {
            const child = fn[schedulableImplementationSignal]
              .apply(thisArg, args)[Symbol.iterator]();
            const first = child.next();
            if (first.done) {
              const value = first.value;
              // Let await assimilate possible thenables without reading `then`
              // ourselves: getters must be read only once.
              nextArg = value !== null && (typeof value === "object" || typeof value === "function")
                ? await value
                : value;
            } else {
              nextArg = await executeIterableAsync(child, scheduleSignal, first);
            }
          } else {
            nextArg = fn.apply(thisArg, args);
          }
          continue;
        }
        case "syncAware": {
          const { async, args, this: thisArg, startImmediately } = result.value;
          if (!startImmediately && scheduleSignal.shouldYield) {
            schedule(continueLoop);
            yield;
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
}

function schedule(fn: () => void) {
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = () => {
    port1.close?.();
    fn();
  };
  port2.postMessage(null);
}
