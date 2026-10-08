import assert from "node:assert/strict";
import test from "node:test";
import { makeSchedulable, async, execute, yieldNow } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

test("execute composes schedulable functions", async () => {
  const sum = makeSchedulable(function* (values: number[]): SchedulableIterable<number> {
    return values.reduce((total, value) => total + value, 0);
  });
  const sumBatches = makeSchedulable(function* (batches: number[][]): SchedulableIterable<number> {
    let total = 0;
    for (const batch of batches) {
      total += yield* execute(sum, undefined, [batch]);
    }
    return total;
  });

  assert.equal(sumBatches([[1, 2], [3]]), 6);
  assert.equal(await async(sumBatches)([[1, 2], [3]]), 6);
});

test("execute forwards this and arguments to an ordinary function", async () => {
  const receiver = { total: 10 };
  function add(this: typeof receiver, value: number) {
    assert.equal(this, receiver);
    this.total += value;
    return this.total;
  }
  const work = makeSchedulable(function* (): SchedulableIterable<number> {
    return yield* execute(add, receiver, [3]);
  });

  assert.equal(work(), 13);
  assert.equal(receiver.total, 13);
  receiver.total = 10;
  assert.equal(await async(work)(), 13);
  assert.equal(receiver.total, 13);
});

test("execute forwards this and arguments to a schedulable function", async () => {
  const receiver = { total: 10 };
  const add = makeSchedulable(function* (
    this: typeof receiver,
    value: number,
  ): SchedulableIterable<number> {
    assert.equal(this, receiver);
    yield* yieldNow();
    assert.equal(this, receiver);
    this.total += value;
    return this.total;
  });
  const work = makeSchedulable(function* (): SchedulableIterable<number> {
    return yield* execute(add, receiver, [3]);
  });

  assert.equal(work(), 13);
  assert.equal(receiver.total, 13);
  receiver.total = 10;
  assert.equal(await async(work)(), 13);
  assert.equal(receiver.total, 13);
});
