import assert from "node:assert/strict";
import test from "node:test";
import { makeSchedulable, asyncScheduler, yieldNow } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

test("yieldNow pauses scheduled execution", async () => {
  let finished = false;
  const work = makeSchedulable(function* (): SchedulableIterable<number> {
    yield yieldNow;
    finished = true;
    return 42;
  });

  const pending = asyncScheduler(work, []);
  assert.equal(finished, false);
  assert.equal(await pending, 42);
  assert.equal(finished, true);
  assert.equal(work(), 42);
});
