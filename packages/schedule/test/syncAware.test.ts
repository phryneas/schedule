import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSchedulable, async, syncAware, getSignal, yieldNow } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

test("syncAware supports async-only operations and rejects synchronous execution", async () => {
  let calls = 0;
  const operation = syncAware({
    async async(this: { base: number }, value: number) {
      calls++;
      return this.base + value;
    },
  });
  const work = makeSchedulable(function* () {
    return yield* operation.call({ base: 40 }, 2);
  });
  assert.throws(() => work(), {
    message: "Synchronous execution is not supported for this syncAware command.",
  });
  assert.equal(calls, 0);
  assert.equal(await async(work.schedulable()), 42);
  assert.equal(calls, 1);
});

test("syncAware wrappers reuse arguments and receivers independently in both schedulers", async () => {
  const calls: string[] = [];
  const add = syncAware({
    sync(this: { base: number }, value: number) {
      calls.push("sync");
      return this.base + value;
    },
    async async(this: { base: number }, value: number) {
      calls.push("async");
      await Promise.resolve();
      return this.base + value;
    },
  });
  const first = { base: 10 };
  const second = { base: 20 };
  const work = makeSchedulable(function* (value: number) {
    return [yield* add.call(first, value), yield* add.bind(second)(value + 1)];
  });
  assert.deepEqual(work(1), [11, 22]);
  assert.deepEqual(await Promise.all([async(work.schedulable(2)), async(work.schedulable(3))]), [[12, 23], [13, 24]]);
  assert.deepEqual(calls, ["sync", "sync", "async", "async", "async", "async"]);
  const result = add.call(first, 1).next();
  assert.equal(result.done, false);
  assert.equal(result.value.kind, "syncAware");
});

test("syncAware reads a file and sums its lines in both modes", async () => {
  const sumFile = makeSchedulable(function* (
    directory: string,
    filename: string,
  ): SchedulableIterable<number> {
    const filePath = join(directory, filename);
    const signal = yield* getSignal;
    const contents = yield* syncAware({
      sync: (file: string) => readFileSync(file, "utf8"),
      async: (file: string) => readFile(file, "utf8"),
    })(filePath);

    let total = 0;
    for (const line of contents.split(/\r?\n/)) {
      if (signal.shouldYield) {
        yield* yieldNow;
      }
      total += Number(line);
    }
    return total;
  });

  const directory = fileURLToPath(new URL("./fixtures/", import.meta.url));
  assert.equal(sumFile(directory, "numbers.txt"), 6);
  assert.equal(await async(sumFile.schedulable(directory, "numbers.txt")), 6);
});
