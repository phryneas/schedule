import assert from "node:assert/strict";
import test from "node:test";
import { async, getSignal, makeSchedulable, syncAware, yieldNow } from "../src/index.ts";

for (const startImmediately of [false, true]) {
  test(`direct iterable entry timing with startImmediately=${startImmediately}`, async () => {
    const events: string[] = [];
    function* work() {
      events.push("started");
      yield* yieldNow;
      return Promise.resolve(42);
    }
    const pending = async(work(), { startImmediately });
    assert.ok(pending instanceof Promise);
    assert.deepEqual(events, startImmediately ? ["started"] : []);
    await Promise.resolve();
    assert.deepEqual(events, startImmediately ? ["started"] : []);
    assert.equal(await pending, 42);
  });
}

test("direct command iterable preserves arguments and receiver", async () => {
  const work = makeSchedulable(function* (this: { base: number }, value: number) {
    yield* getSignal;
    return this.base + value;
  });
  assert.equal(await async(work.schedulable.call({ base: 40 }, 2)), 42);
});

test("direct iterable rejects generator errors", async () => {
  const reason = new Error("failed");
  function* work() { throw reason; }
  const pending = async(work(), { startImmediately: true });
  await assert.rejects(pending, error => error === reason);
});

test("direct iterable observes cancellation before deferred entry", async () => {
  const controller = new AbortController();
  let started = false;
  function* work() { started = true; }
  const pending = async(work(), { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(started, false);
});

test("direct iterable cancellation interrupts pending operations and closes the generator", async () => {
  const controller = new AbortController();
  let closed = false;
  function* work() {
    try {
      yield* syncAware({
        sync() {},
        async: () => new Promise<void>(() => {}),
        startImmediately: true,
      })();
    } finally {
      closed = true;
    }
  }
  const pending = async(work(), { signal: controller.signal, startImmediately: true });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(closed, true);
});
