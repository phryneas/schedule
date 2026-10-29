import assert from "node:assert/strict";
import test from "node:test";
import { async, commands, makeSchedulable } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

test("short scheduled children share the parent's deadline", async (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const child = makeSchedulable(function* (): SchedulableIterable<void> {
    now += 10;
  });
  const parent = makeSchedulable(function* (): SchedulableIterable<void> {
    const signal = yield* commands.getSignal;
    yield* child.schedulable();
    assert.equal(signal.shouldYield, false);
    yield* child.schedulable();
    assert.equal(signal.shouldYield, true);
    // The next command must yield before entering the callback.
    yield* commands.execute(() => assert.equal(signal.shouldYield, false))();
  });
  await async(parent.schedulable());
});

test("an already resolved syncAware promise does not reset the deadline", async (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const work = makeSchedulable(function* (): SchedulableIterable<void> {
    const signal = yield* commands.getSignal;
    yield* commands.syncAware({
      sync() {},
      async() { now = 20; return Promise.resolve(); },
    })();
    assert.equal(signal.shouldYield, true);
    yield* commands.yieldNow;
    assert.equal(signal.shouldYield, false);
  });
  await async(work.schedulable());
});

test("returning from a child preserves time spent since its last actual yield", async (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const child = makeSchedulable(function* (): SchedulableIterable<void> {
    now = 20;
    yield* commands.yieldNow;
    now = 40;
  });
  const parent = makeSchedulable(function* (): SchedulableIterable<void> {
    const signal = yield* commands.getSignal;
    yield* child.schedulable();
    assert.equal(signal.shouldYield, true);
  });
  await async(parent.schedulable());
});
