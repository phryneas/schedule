import assert from "node:assert/strict";
import test from "node:test";
import {
  makeSchedulable,
  async,
  getSignal,
  yieldNow,
  sync,
} from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

const sum = makeSchedulable(function* (
  values: number[],
): SchedulableIterable<number> {
  const signal = yield* getSignal;
  let total = 0;
  for (const value of values) {
    if (signal.shouldYield) yield* yieldNow;
    total += value;
  }
  return total;
});

test("sum runs synchronously", () => {
  assert.equal(sum([1, 2, 3]), 6);
  assert.equal(sync(sum.schedulable([1, 2, 3])), 6);
});

test("sum runs with the scheduler", async () => {
  assert.equal(await async(sum.schedulable([1, 2, 3])), 6);
});

test("sync and async forward arguments and this", async () => {
  const add = makeSchedulable(function* (
    this: { offset: number },
    value: number,
  ): SchedulableIterable<number> {
    return this.offset + value;
  });
  assert.equal(sync(add.schedulable.call({ offset: 10 }, 2)), 12);
  assert.equal(await async(add.schedulable.call({ offset: 10 }, 2)), 12);
});
