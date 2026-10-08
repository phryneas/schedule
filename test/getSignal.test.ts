import assert from "node:assert/strict";
import test from "node:test";
import { asyncScheduler, getSignal, makeSchedulable, syncAware } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

test("getSignal throws outside scheduler execution", () => {
  assert.throws(() => getSignal(), /synchronous scheduler execution/);
});

test("getSignal works inside sync and async scheduler execution", async () => {
  const work = makeSchedulable(function* (): SchedulableIterable<boolean> {
    return getSignal().aborted;
  });

  assert.equal(work(), false);
  assert.throws(() => getSignal(), /synchronous scheduler execution/);
  assert.equal(await asyncScheduler(work, []), false);
  assert.throws(() => getSignal(), /synchronous scheduler execution/);
});

test("async syncAware callbacks use a signal captured by the generator", async () => {
  const controller = new AbortController();
  const work = makeSchedulable(function* (): SchedulableIterable<void> {
    const signal = getSignal();
    yield* syncAware({
      sync: () => {
        assert.equal(getSignal(), signal);
      },
      async: async () => {
        assert.throws(() => getSignal(), /synchronous scheduler execution/);
        await Promise.resolve();
        assert.throws(() => getSignal(), /synchronous scheduler execution/);
        controller.abort();
        assert.equal(signal.aborted, true);
        assert.throws(() => signal.throwIfAborted(), { name: "AbortError" });
      },
      args: [],
    });
  });

  work();
  const pending = asyncScheduler(work, [], controller.signal);
  assert.throws(() => getSignal(), /synchronous scheduler execution/);
  await pending;
});
