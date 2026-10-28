import assert from "node:assert/strict";
import test from "node:test";
import { async, getSignal, makeSchedulable, syncAware } from "../src/index.ts";
import type { SchedulableIterable, ScheduleSignal } from "../src/types.ts";

test("getSignal preserves the supplied signal across repeated acquisitions", async () => {
  const signal: ScheduleSignal = {
    aborted: false,
    shouldYield: false,
    throwIfAborted() {},
    addEventListener() {},
    removeEventListener() {},
    bump() {},
  };
  const work = makeSchedulable(function* (): SchedulableIterable<ScheduleSignal> {
    const first = yield* getSignal;
    assert.equal(yield* getSignal, first);
    return first;
  });
  assert.equal(work().aborted, false);
  assert.equal(await async(work, { signal })(), signal);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(async(work, { signal: controller.signal })(), { name: "AbortError" });
});

test("getSignal creates a command", () => {
  assert.deepEqual(getSignal.next(), { done: false, value: { kind: "getSignal" } });
});

test("getSignal forwards abort event subscriptions to the supplied AbortSignal", async () => {
  const controller = new AbortController();
  const work = makeSchedulable(function* () {
    return yield* getSignal;
  });
  const signal = await async(work, { signal: controller.signal })();
  let calls = 0;
  const listener = () => { calls++; };
  const removed = () => assert.fail("removed listener must not run");
  signal.addEventListener("abort", listener, { once: true });
  signal.addEventListener("abort", removed);
  signal.removeEventListener("abort", removed);
  controller.abort();
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
});

test("getSignal works inside sync and async scheduler execution", async () => {
  const work = makeSchedulable(function* (): SchedulableIterable<boolean> {
    return (yield* getSignal).aborted;
  });

  assert.equal(work(), false);
  assert.equal(await async(work)(), false);
});

test("async syncAware callbacks use a signal captured by the generator", async () => {
  const controller = new AbortController();
  const work = makeSchedulable(function* (): SchedulableIterable<void> {
    const signal = yield* getSignal;
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
  const pending = async(work, { signal: controller.signal })();
  await assert.rejects(pending, { name: "AbortError" });
});

test("requesting a signal rejects an already aborted run", async () => {
  const controller = new AbortController();
  controller.abort();
  const work = makeSchedulable(function* () {
    return yield* getSignal;
  });
  await assert.rejects(async(work, { signal: controller.signal })(), { name: "AbortError" });
});
