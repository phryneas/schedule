# @phryneas/schedule

Write a computation once and run it synchronously or cooperatively, giving the
event loop time to handle input and rendering between chunks of work.

Install with `npm install @phryneas/schedule`.

## Getting started

Use a regular generator with `makeSchedulable`. Check the scheduling signal
inside expensive loops and yield when its time budget is used up.

```ts
import { makeSchedulable, commands, sync, async } from "@phryneas/schedule";
import type { SchedulableIterable } from "@phryneas/schedule";

const sum = makeSchedulable(function* sum(
  values: number[],
): SchedulableIterable<number> {
  const signal = yield* commands.getSignal;
  let total = 0;
  for (const value of values) {
    if (signal.shouldYield) {
      yield* commands.yieldNow;
    }
    total += value;
  }
  return total;
});

sum([1, 2, 3]);              // 6, synchronously
sync(sum)([1, 2, 3]);        // 6, synchronously
await async(sum)([1, 2, 3]); // 6, cooperatively
```

Call the function directly or use `sync(fn)(...args)` for a synchronous result.
Use `await async(fn, signal?)(...args)` to let other work run between chunks.

## Commands

Import `commands` and use `yield*` with each command inside your generator.

### `commands.getSignal`

Get the current run's signal. Capture it once to check when to yield or whether
the run has been cancelled.

```ts
const signal = yield* commands.getSignal;
```

Read `signal.shouldYield` to decide when to pause. It also checks for
cancellation. Use `signal.throwIfAborted()` when you only need a cancellation
check.

### `commands.yieldNow`

Pause to let other work run, then continue where you left off. In synchronous
execution, this command continues immediately.

```ts
if (signal.shouldYield) {
  yield* commands.yieldNow;
}
```

Put this check inside long loops, as in `sum` above, to keep the UI responsive.

### `commands.execute(fn)(...args)`

Call another function and get its result, using the current execution mode.
Schedulable functions inherit the current scheduler they are running in.
Promise-valued results are passed back unchanged, so callers can start other
operations before waiting for them. This also applies to the `.command` shortcut.

```ts
const sumBatches = makeSchedulable(function* sumBatches(
  batches: number[][],
): SchedulableIterable<number> {
  let total = 0;
  for (const batch of batches) {
    total += yield* commands.execute(sum)(batch);
  }
  return total;
});
```

Ordinary functions and callbacks also work, but run uninterrupted once called.
For methods, bind the receiver: `yield* commands.execute(object.method).bind(object)(arg)`.

Functions created with `makeSchedulable` also have a reusable `.command` shortcut instead of calling `commands.execute`:

```ts
const total = yield* sum.command(values);
const result = yield* object.method.command.bind(object)(arg);
```

Use `commands.execute` for callbacks that may be ordinary functions. When
supplying a full generic or overloaded signature to `makeSchedulable`, include
the generator call signatures in its `command` property too.

### `commands.syncAware({ sync, async })(...args)`

Call an external dependency's synchronous or promise-returning implementation,
depending on how your function is run, and get its result.
In async mode, the scheduler awaits the async implementation before resuming
the caller.

The returned wrapper can be reused across calls and schedulers. Use `.call` or
`.bind` when the implementations need a receiver.

```ts
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const sumFile = makeSchedulable(function* sumFile(
  directory: string,
  filename: string,
): SchedulableIterable<number> {
  const signal = yield* commands.getSignal;

  const filePath = join(directory, filename);

  const contents = yield* commands.syncAware({
    sync: (file: string) => readFileSync(file, "utf8"),
    async: (file: string) => readFile(file, "utf8"),
  })(filePath);

  let total = 0;
  for (const line of contents.split(/\r?\n/)) {
    if (signal.shouldYield) {
      yield* commands.yieldNow;
    }
    total += Number(line);
  }
  return total;
});
```

A direct call to `sumFile` reads the file synchronously. Running it with
`async(sumFile)(directory, filename)` uses the non-blocking `readFile` and lets
the summing loop yield as needed.

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

Work stops at its next cancellation check. To cancel an external operation too,
pass it an abort signal if its API supports one.

## Codemod

To transform existing TypeScript code, see
[`@phryneas/schedule-codemod`](https://www.npmjs.com/package/@phryneas/schedule-codemod).
