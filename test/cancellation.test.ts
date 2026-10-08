import assert from "node:assert/strict";
import test from "node:test";
import { makeSchedulable, async, getSignal, yieldNow, execute } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

test("AbortController cancels scheduled work", async () => {
  const work = makeSchedulable(function* (): SchedulableIterable<number> {
    const signal = getSignal();
    yield yieldNow;
    signal.throwIfAborted();
    return 42;
  });
  const controller = new AbortController();
  const pending = async(work, controller.signal)();
  controller.abort();

  await assert.rejects(pending, { name: "AbortError" });
});

test("execute propagates cancellation without affecting concurrent runs", async () => {
  const work = makeSchedulable(function* (): SchedulableIterable<number> {
    const signal = getSignal();
    yield yieldNow;
    signal.throwIfAborted();
    return 42;
  });
  const parent = makeSchedulable(function* (): SchedulableIterable<number> {
    return yield* execute(work, undefined, []);
  });
  const controller = new AbortController();
  const pending = async(parent, controller.signal)();
  const independent = async(parent)();
  controller.abort();

  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(await independent, 42);
});

test("ordinary execute callbacks receive context and clear it when throwing", async () => {
  const reason = new Error("callback failed");
  const parent = makeSchedulable(function* (): SchedulableIterable<void> {
    const signal = getSignal();
    yield* execute(() => {
      assert.equal(getSignal(), signal);
      throw reason;
    }, undefined, []);
  });

  await assert.rejects(async(parent)(), (error) => error === reason);
  assert.throws(() => getSignal(), /synchronous scheduler execution/);
});
