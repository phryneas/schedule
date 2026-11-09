import { getSchedulableImplementation } from "./internal.ts";
import { isSchedulableFunction } from "./isSchedulableFunction.ts";
import type { Command } from "./commands.ts";
import { ScheduleController } from "./scheduleController.ts";
import type { SchedulableIterable, ScheduleSignal } from "./types.ts";
import { noop } from "./noop.ts";

interface AsyncOptions<EmittedValue> {
  signal?: AbortSignal | ScheduleSignal;
  startImmediately?: boolean;
  onValue?: (value: EmittedValue) => void;
}

export async function async<T, EmittedValue = never>(
  iterable: SchedulableIterable<T, EmittedValue>,
  { signal, startImmediately, onValue }: AsyncOptions<EmittedValue> = {},
): Promise<Awaited<T>> {
  const controller =
    signal && "shouldYield" in signal
      ? undefined
      : new ScheduleController(signal ? { signal } : {});
  const scheduleSignal = controller?.signal ?? (signal as ScheduleSignal);
  try {
    if (!startImmediately) {
      await new Promise<void>((resolve) => scheduleSignal.schedule(resolve));
      scheduleSignal.bump();
    }
    scheduleSignal.throwIfAborted();
    return await executeIterableAsync(iterable, scheduleSignal, onValue);
  } finally {
    controller?.dispose();
  }
}

async function executeIterableAsync<T, EmittedValue>(
  iterable: SchedulableIterable<T, EmittedValue>,
  scheduleSignal: ScheduleSignal,
  onValue?: (value: EmittedValue) => void,
): Promise<Awaited<T>> {
  const parents: SchedulableIterable<unknown, EmittedValue>[] = [];
  let iterator: SchedulableIterable<unknown, EmittedValue> =
    iterable[Symbol.iterator]();
  let nextArg: unknown;
  let throwing = false;
  let checkDeadlineBeforeResume = false;
  do {
    checkAborted();
    try {
      if (checkDeadlineBeforeResume && scheduleSignal.shouldYield) {
        if (!throwing) observeRejection(nextArg);
        await new Promise<void>((resolve) => scheduleSignal.schedule(resolve));
        checkAborted();
        scheduleSignal.bump();
      }
    } catch (error) {
      nextArg = error;
      throwing = true;
    }
    checkDeadlineBeforeResume = false;
    checkAborted();
    let result: IteratorResult<Command<EmittedValue>, unknown>;
    try {
      result = throwing ? iterator.throw(nextArg) : iterator.next(nextArg);
    } catch (error) {
      const parent = parents.pop();
      if (!parent) throw error;
      iterator = parent;
      nextArg = error;
      throwing = true;
      checkDeadlineBeforeResume = true;
      continue;
    }
    checkAborted();
    throwing = false;
    nextArg = undefined;
    if (result.done) {
      const parent = parents.pop();
      if (!parent) return result.value as Awaited<T>;
      iterator = parent;
      // Returning a promise is distinct from explicitly awaiting a syncAware command.
      nextArg = result.value;
      checkDeadlineBeforeResume = true;
      continue;
    }
    try {
      checkDeadlineBeforeResume =
        result.value.kind === "execute" || result.value.kind === "syncAware";
      if (
        result.value.kind === "yield" ||
        (checkDeadlineBeforeResume && scheduleSignal.shouldYield)
      ) {
        await new Promise<void>((resolve) => scheduleSignal.schedule(resolve));
        checkAborted();
        scheduleSignal.bump();
      }
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
          // A defined resumption value completes the reusable yield command.
          nextArg = null;
          continue;
        }
        case "execute": {
          const { fn, args, this: thisArg } = result.value;
          if (isSchedulableFunction(fn)) {
            const child = getSchedulableImplementation<EmittedValue>(fn)
              .apply(thisArg, args)
              [Symbol.iterator]();
            parents.push(iterator);
            iterator = child;
          } else {
            nextArg = fn.apply(thisArg, args);
          }
          continue;
        }
        case "syncAware": {
          const { async, args, this: thisArg } = result.value;

          const value = async.apply(thisArg, args);
          if (scheduleSignal.aborted) {
            Promise.resolve(value).catch(() => {});
            checkAborted();
          }
          nextArg = await new Promise<unknown>((resolve, reject) => {
            // Wake the scheduler so its terminal cancellation check closes the frames.
            scheduleSignal.addEventListener("abort", reject, { once: true });
            // Keep observing the operation even if cancellation wins the race.
            Promise.resolve(value)
              .then(resolve, reject)
              .finally(() =>
                scheduleSignal.removeEventListener("abort", reject),
              );
          });

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

/** Observe returned promises and thenables before delaying delivery to the caller. */
function observeRejection(value: unknown): void {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  )
    return;
  if (!("then" in value)) return;
  const then = value.then;
  if (typeof then === "function") {
    then.call(value, noop, noop);
  }
}
