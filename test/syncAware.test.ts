import assert from "node:assert/strict";
import test from "node:test";
import { makeSchedulable, asyncScheduler, syncAware } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

test("syncAware works with a normal async function", async () => {
  function sum(values: number[]) {
    return values.reduce((total, value) => total + value, 0);
  }
  async function sumAsync(values: number[]) {
    return sum(values);
  }
  const sumViaDependency = makeSchedulable(function* (
    values: number[],
  ): SchedulableIterable<number> {
    return yield* syncAware({
      sync: sum,
      async: sumAsync,
      args: [values],
    });
  });

  assert.equal(sumViaDependency([1, 2, 3]), 6);
  assert.equal(await asyncScheduler(sumViaDependency, [[1, 2, 3]]), 6);
});

test("syncAware supports synchronous and scheduled calls", async () => {
  const sum = makeSchedulable(function* (
    values: number[],
  ): SchedulableIterable<number> {
    return values.reduce((total, value) => total + value, 0);
  });
  const sumViaDependency = makeSchedulable(function* (
    values: number[],
  ): SchedulableIterable<number> {
    return yield* syncAware({
      sync: sum,
      async: (input: number[]) => asyncScheduler(sum, [input]),
      args: [values],
    });
  });

  assert.equal(sumViaDependency([1, 2, 3]), 6);
  assert.equal(await asyncScheduler(sumViaDependency, [[1, 2, 3]]), 6);
});
