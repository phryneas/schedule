# @phryneas/schedule

Write a computation once and run it synchronously or cooperatively, giving the
event loop time to handle input and rendering between chunks of work.

The examples use this checkout's source paths. The package currently points at
an `index.js` that has not been built; there is no build script yet.

## Write a schedulable function

Use a regular generator with `makeSchedulable`. Check the scheduling signal
inside expensive loops and yield when its time budget is used up.

```ts
import { makeSchedulable, runWithScheduler, scheduler } from "./src/index.ts";
import type { SchedulableIterable } from "./src/types.ts";

const sum = makeSchedulable(function* sum(
  values: number[],
): SchedulableIterable<number> {
  const signal = scheduler.getSignal();
  let total = 0;
  for (const value of values) {
    if (signal.shouldYield) {
      yield scheduler.yieldNow;
    }
    total += value;
  }
  return total;
});

sum([1, 2, 3]);                          // 6, synchronously
sum.sync([1, 2, 3]);                     // also 6, synchronously
await runWithScheduler(sum, [[1, 2, 3]]); // 6, cooperatively
```

Direct calls run to completion without yielding to the event loop.
`runWithScheduler(fn, args, signal?)` returns a promise and uses a roughly 16 ms
budget between yields. Work stays on the same thread: place checkpoints often
enough that no individual chunk blocks the UI for too long.

## Compose functions and callbacks

Inside a generator, use `yield* scheduler.execute(fn, thisArg, args)` to call
another function through the scheduler:

```ts
const sumBatches = makeSchedulable(function* sumBatches(
  batches: number[][],
): SchedulableIterable<number> {
  let total = 0;
  for (const batch of batches) {
    total += yield* scheduler.execute(sum, undefined, [batch]);
  }
  return total;
});
```

Schedulable callees share the caller's scheduling signal. Ordinary functions
and callbacks also work, but run uninterrupted once called. Calling `sum(batch)`
directly would run that entire nested computation synchronously.

Use `yield` for `scheduler.yieldNow`, and `yield*` for `execute` and `syncAware`.
An unconditional `yield scheduler.yieldNow` forces an event-loop break in
scheduled mode; it is ignored in synchronous mode.

## Keep an existing synchronous implementation

`asSchedulable(existingFn, generatorFn)` attaches a schedulable implementation
without changing what a direct call to `existingFn` does. It returns nothing.
`runWithScheduler(existingFn, args)` uses the generator, and `existingFn.sync`
runs that generator synchronously. Keep both implementations equivalent.

For dependencies with separate sync and async entry points, use `syncAware`:

```ts
const sumViaDependency = makeSchedulable(function* sumViaDependency(
  values: number[],
): SchedulableIterable<number> {
  return yield* scheduler.syncAware({
    sync: sum,
    async: (input: number[]) => runWithScheduler(sum, [input]),
    args: [values],
  });
});
```

The sync runner chooses `sync`; the scheduled runner awaits `async`. This is
also useful for separate memoized sync and async implementations.
Cancellation propagation through nested `runWithScheduler` calls is currently
incomplete; see [TODOs](TODOs.md).

## Cancel stale work

Pass an `AbortSignal` to the outer call and abort when the result is no longer
needed, for example when editor input changes or a component unmounts.

```ts
const controller = new AbortController();
const pending = runWithScheduler(sum, [[1, 2, 3]], controller.signal);

// From an input-change handler or cleanup:
controller.abort();

try {
  const result = await pending;
  if (!controller.signal.aborted) {
    console.log(result); // publish only if this run is still current
  }
} catch (error) {
  if (!controller.signal.aborted) throw error;
}
```

Cancellation is cooperative: `getSignal()`, reading `signal.shouldYield`, and
`signal.throwIfAborted()` check for cancellation. Aborting cannot interrupt an
ordinary function already running, and does not automatically cancel promises
or shared memoized work. Keep each run's controller local when guarding results.

See [TODOs](TODOs.md) for current limitations and follow-up work.
