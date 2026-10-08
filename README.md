# @phryneas/schedule

Write a computation once and run it synchronously or cooperatively, giving the
event loop time to handle input and rendering between chunks of work.

The examples use this checkout's source paths. Run `npm test` with Node.js 24+
to test them, or `npm run build` to compile the source into `dist`.

## Write a schedulable function

Use a regular generator with `makeSchedulable`. Check the scheduling signal
inside expensive loops and yield when its time budget is used up.

```ts
import { makeSchedulable, sync, async } from "./src/index.ts";
import * as scheduler from "./src/index.ts";
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

sum([1, 2, 3]);              // 6, synchronously
sync(sum)([1, 2, 3]);        // 6, synchronously
await async(sum)([1, 2, 3]); // 6, cooperatively
```

Direct calls run to completion without yielding to the event loop.
Use `async(fn, signal?)(...args)` to run a function cooperatively and await its
result, or `sync(fn)(...args)` to run it synchronously.
Scheduled work uses a roughly 16 ms budget between yields and stays on the same
thread: place checkpoints often enough to keep the UI responsive.

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

Use `execute` to compose schedulable functions inside a generator. Ordinary
functions and callbacks also work, but run uninterrupted once called.

Use `yield` for `scheduler.yieldNow`, and `yield*` for `execute` and `syncAware`.
An unconditional `yield scheduler.yieldNow` forces an event-loop break in
scheduled mode; it is ignored in synchronous mode.

## Use separate sync and async implementations

For dependencies with separate sync and async entry points, use `syncAware`:

```ts
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const sumFile = makeSchedulable(function* sumFile(
  directory: string,
  filename: string,
): SchedulableIterable<number> {
  const signal = scheduler.getSignal();

  const filePath = join(directory, filename);
  
  const contents = yield* scheduler.syncAware({
    sync: (file: string) => readFileSync(file, "utf8"),
    async: (file: string) => readFile(file, "utf8"),
    args: [filePath],
  });

  let total = 0;
  for (const line of contents.split(/\r?\n/)) {
    if (signal.shouldYield) {
      yield scheduler.yieldNow;
    }
    total += Number(line);
  }
  return total;
});
```

A direct call to `sumFile` reads the file synchronously. Running it with
`async(sumFile)(directory, filename)` uses the non-blocking `readFile` and lets the summing loop yield
as needed. Call `getSignal()` in your generator, as shown above.

## Cancel stale work

Pass an `AbortSignal` to the outer call and abort when the result is no longer
needed, for example when editor input changes or a component unmounts.

```ts
const controller = new AbortController();
const pending = async(sum, controller.signal)([1, 2, 3]);

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
