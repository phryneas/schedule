import assert from "node:assert/strict";
import test from "node:test";
import { makeSchedulable, runWithScheduler, execute } from "../src/index.ts";
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
  assert.equal(await runWithScheduler(sumBatches, [[[1, 2], [3]]]), 6);
});
