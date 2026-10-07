import assert from "node:assert/strict";
import test from "node:test";
import { asSchedulable, runWithScheduler } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

test("asSchedulable adapts an existing function", async () => {
  function double(value: number) {
    return value * 2;
  }
  asSchedulable(double, function* (value: number): SchedulableIterable<number> {
    return value * 2;
  });

  assert.equal(double(3), 6);
  assert.equal(double.sync(3), 6);
  assert.equal(await runWithScheduler(double, [3]), 6);
});
