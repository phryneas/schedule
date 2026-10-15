import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSchedulable, async, syncAware, getSignal, yieldNow } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

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
    startImmediately: true,
  });
  const first = { base: 10 };
  const second = { base: 20 };
  const work = makeSchedulable(function* (value: number) {
    return [yield* add.call(first, value), yield* add.bind(second)(value + 1)];
  });
  assert.deepEqual(work(1), [11, 22]);
  assert.deepEqual(await Promise.all([async(work)(2), async(work)(3)]), [[12, 23], [13, 24]]);
  assert.deepEqual(calls, ["sync", "sync", "async", "async", "async", "async"]);
  assert.equal(add.call(first, 1).next().value.startImmediately, true);
});

test("syncAware reads a file and sums its lines in both modes", async () => {
  const sumFile = makeSchedulable(function* (
    directory: string,
    filename: string,
  ): SchedulableIterable<number> {
    const filePath = join(directory, filename);
    const signal = yield* getSignal();
    const contents = yield* syncAware({
      sync: (file: string) => readFileSync(file, "utf8"),
      async: (file: string) => readFile(file, "utf8"),
    })(filePath);

    let total = 0;
    for (const line of contents.split(/\r?\n/)) {
      if (signal.shouldYield) {
        yield* yieldNow();
      }
      total += Number(line);
    }
    return total;
  });

  const directory = fileURLToPath(new URL("./fixtures/", import.meta.url));
  assert.equal(sumFile(directory, "numbers.txt"), 6);
  assert.equal(await async(sumFile)(directory, "numbers.txt"), 6);
});
