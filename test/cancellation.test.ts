import assert from "node:assert/strict";
import test from "node:test";
import { makeSchedulable, asyncScheduler, getSignal, yieldNow } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

test("AbortController cancels scheduled work", async () => {
  const work = makeSchedulable(function* (): SchedulableIterable<number> {
    const signal = getSignal();
    yield yieldNow;
    signal.throwIfAborted();
    return 42;
  });
  const controller = new AbortController();
  const pending = asyncScheduler(work, [], controller.signal);
  controller.abort();

  await assert.rejects(pending, { name: "AbortError" });
});
