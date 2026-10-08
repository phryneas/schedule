import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSchedulable, asyncScheduler, syncAware, getSignal, yieldNow } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

test("syncAware reads a file and sums its lines in both modes", async () => {
  const sumFile = makeSchedulable(function* (
    directory: string,
    filename: string,
  ): SchedulableIterable<number> {
    const filePath = join(directory, filename);
    const signal = getSignal();
    const contents = yield* syncAware({
      sync: (file: string) => readFileSync(file, "utf8"),
      async: (file: string) => readFile(file, "utf8"),
      args: [filePath],
    });

    let total = 0;
    for (const line of contents.split(/\r?\n/)) {
      if (signal.shouldYield) {
        yield yieldNow;
      }
      total += Number(line);
    }
    return total;
  });

  const directory = fileURLToPath(new URL("./fixtures/", import.meta.url));
  assert.equal(sumFile(directory, "numbers.txt"), 6);
  assert.equal(await asyncScheduler(sumFile, [directory, "numbers.txt"]), 6);
});
