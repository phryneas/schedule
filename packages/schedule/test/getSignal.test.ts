import assert from "node:assert/strict";
import test from "node:test";
import { async, getSignal, makeSchedulable, syncAware } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

test("getSignal creates a command", () => {
  assert.deepEqual(getSignal().next(), { done: false, value: { kind: "getSignal" } });
});

test("getSignal works inside sync and async scheduler execution", async () => {
  const work = makeSchedulable(function* (): SchedulableIterable<boolean> {
    return (yield* getSignal()).aborted;
  });

  assert.equal(work(), false);
  assert.equal(await async(work)(), false);
});

test("async syncAware callbacks use a signal captured by the generator", async () => {
  const controller = new AbortController();
  const work = makeSchedulable(function* (): SchedulableIterable<void> {
    const signal = yield* getSignal();
    yield* syncAware({
      sync: () => {
        assert.equal(signal.aborted, false);
      },
      async: async () => {
        await Promise.resolve();
        controller.abort();
        assert.equal(signal.aborted, true);
        assert.throws(() => signal.throwIfAborted(), { name: "AbortError" });
      },
    })();
  });

  work();
  const pending = async(work, controller.signal)();
  await pending;
});

test("requesting a signal rejects an already aborted run", async () => {
  const controller = new AbortController();
  controller.abort();
  const work = makeSchedulable(function* () {
    return yield* getSignal();
  });
  await assert.rejects(async(work, controller.signal)(), { name: "AbortError" });
});
