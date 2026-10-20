import assert from "node:assert/strict";
import test from "node:test";
import { makeSchedulable, async, execute, yieldNow } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

test("execute supports dynamically narrowed ordinary and schedulable methods", async () => {
  const serialize = makeSchedulable(function* (value: Record<string, unknown>) {
    if (typeof value.toJSON === "function") {
      return yield* execute(value.toJSON).bind(value)(3);
    }
    return value;
  });
  const ordinary = { total: 10, toJSON(amount: number) { return this.total + amount; } };
  const scheduled = {
    total: 20,
    toJSON: makeSchedulable(function* (this: { total: number }, amount: number) {
      yield* yieldNow;
      return this.total + amount;
    }),
  };
  for (const [value, expected] of [[ordinary, 13], [scheduled, 23]] as const) {
    assert.equal(serialize(value), expected);
    assert.equal(await async(serialize)(value), expected);
  }
});

test("execute composes schedulable functions", async () => {
  const sum = makeSchedulable(function* (values: number[]): SchedulableIterable<number> {
    return values.reduce((total, value) => total + value, 0);
  });
  const sumBatches = makeSchedulable(function* (batches: number[][]): SchedulableIterable<number> {
    let total = 0;
    for (const batch of batches) {
      total += yield* execute(sum)(batch);
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
    return yield* execute(add).bind(receiver)(3);
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
    yield* yieldNow;
    assert.equal(this, receiver);
    this.total += value;
    return this.total;
  });
  const work = makeSchedulable(function* (): SchedulableIterable<number> {
    return yield* execute(add).bind(receiver)(3);
  });

  assert.equal(work(), 13);
  assert.equal(receiver.total, 13);
  receiver.total = 10;
  assert.equal(await async(work)(), 13);
  assert.equal(receiver.total, 13);
});
