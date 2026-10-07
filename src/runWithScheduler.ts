import type { Command } from "./commands.ts";
import { context, schedulableImplementationSignal } from "./internal.ts";
import { isSchedulableFunction } from "./isSchedulableFunction.ts";
import type {
  SchedulableFunction,
  SchedulableIterable,
  ScheduleSignal,
} from "./types.ts";

export function runWithScheduler<Ret, Args extends Array<unknown>>(
  fn: ((..._: Args) => Ret) | SchedulableFunction<Ret, Args>,
  args: Args,
  abortSignal?: AbortSignal | ScheduleSignal,
): Promise<Ret> {
  if (!isSchedulableFunction(fn)) {
    // eslint-disable-next-line no-undef, no-console
    console?.warn("Running a non-schedulable function with runWithScheduler!");
    return Promise.resolve().then(() => fn(...args));
  }
  return chunkedScheduler(
    fn[schedulableImplementationSignal](...args),
    abortSignal,
  ) as Promise<Ret>;
}

function chunkedScheduler<T>(
  iterable: SchedulableIterable<T>,
  abortSignal?: AbortSignal | ScheduleSignal,
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
    const iterator = iterable[Symbol.iterator]();
    let nextArg: unknown;
    do {
      let result: IteratorResult<Command, T>;
      const previousSignal = context.signal;
      try {
        context.signal = scheduleSignal;
        result = iterator.next(nextArg);
        nextArg = undefined;
      } finally {
        context.signal = previousSignal;
      }
      if (result.done) {
        return result.value as Awaited<T>;
      }
      switch (result.value.kind) {
        case "yield": {
          schedule(continueLoop);
          yield;
          scheduleSignal.bump();
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
            nextArg = await chunkedScheduler(
              fn[schedulableImplementationSignal](...args),
              scheduleSignal,
            );
            // we are just back from an async call, so we don't need to yield again for a while
            scheduleSignal.bump();
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
          // we are just back from an async call, so we don't need to yield again for a while
          scheduleSignal.bump();
          continue;
        }
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
