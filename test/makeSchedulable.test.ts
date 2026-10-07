import assert from "node:assert/strict";
import test from "node:test";
import { makeSchedulable, runWithScheduler, getSignal, yieldNow } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

const sum = makeSchedulable(function* (values: number[]): SchedulableIterable<number> {
  const signal = getSignal();
  let total = 0;
  for (const value of values) {
    if (signal.shouldYield) yield yieldNow;
    total += value;
  }
  return total;
});

test("sum runs synchronously", () => {
  assert.equal(sum([1, 2, 3]), 6);
  assert.equal(sum.sync([1, 2, 3]), 6);
});

test("sum runs with the scheduler", async () => {
  assert.equal(await runWithScheduler(sum, [[1, 2, 3]]), 6);
});
