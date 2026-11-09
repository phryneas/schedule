import { ScheduleController } from "../src/index.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { async, getSignal, makeSchedulable, sync, syncAware } from "../src/index.ts";
import type { SchedulableIterable, ScheduleSignal } from "../src/types.ts";

test("getSignal preserves the supplied signal across repeated acquisitions", async () => {
  const signal = new (class extends ScheduleController {
      protected override get shouldYield() { return false; }
      protected override bump() {}
    })().signal;
  const work = makeSchedulable(function* (): SchedulableIterable<ScheduleSignal> {
    const first = yield* getSignal;
    assert.equal(yield* getSignal, first);
    return first;
  });
  assert.equal(work().aborted, false);
  assert.equal(await async(work.schedulable(), { signal }), signal);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(async(work.schedulable(), { signal: controller.signal }), { name: "AbortError" });
});

test("getSignal creates a command", () => {
  assert.deepEqual(getSignal.next(), { done: false, value: { kind: "getSignal" } });
});

test("synchronous getSignal exposes a full native AbortSignal", () => {
  const work = makeSchedulable(function* () {
    return yield* getSignal;
  });
  const signal = work();
  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal.aborted, false);
  assert.equal(signal.reason, undefined);
  assert.equal(signal.onabort, null);
  signal.throwIfAborted();
  assert.equal(new Request("https://example.com", { signal }).signal.aborted, false);

  let calls = 0;
  signal.onabort = () => { calls++; };
  try {
    assert.equal(signal.dispatchEvent(new Event("abort")), true);
    assert.equal(calls, 1);
    assert.equal(signal.aborted, false);
  } finally {
    signal.onabort = null;
  }
});

test("nested synchronous calls share the outer run's signal", () => {
  const child = makeSchedulable(function* () {
    return yield* getSignal;
  });
  const parent = makeSchedulable(function* () {
    const signal = yield* getSignal;
    assert.equal(yield* child.schedulable(), signal);
    assert.equal(child(), signal);
    assert.equal(sync(getSignal), signal);
    const fromCallback = yield* syncAware({
      sync: () => child(),
      async: async () => child(),
    })();
    assert.equal(fromCallback, signal);
    assert.equal(yield* getSignal, signal);
    return signal;
  });

  assert.notEqual(parent(), parent());
});

test("completed synchronous runs isolate listeners and later microtasks", async () => {
  const first = sync(getSignal);
  let calls = 0;
  first.addEventListener("abort", () => { calls++; });
  first.onabort = () => { calls++; };

  const second = sync(getSignal);
  assert.notEqual(second, first);
  assert.equal(second.onabort, null);
  second.dispatchEvent(new Event("abort"));
  assert.equal(calls, 0);
  first.dispatchEvent(new Event("abort"));
  assert.equal(calls, 2);

  let later!: Promise<ScheduleSignal>;
  const work = makeSchedulable(function* () {
    later = Promise.resolve().then(() => sync(getSignal));
    return yield* getSignal;
  });
  const duringRun = work();
  assert.notEqual(await later, duringRun);
});

test("throwing synchronous calls restore the enclosing signal and release the outer run", () => {
  const error = new Error("child failed");
  let failedSignal: ScheduleSignal | undefined;
  const fail = makeSchedulable(function* () {
    failedSignal = yield* getSignal;
    throw error;
  });
  const parent = makeSchedulable(function* () {
    const signal = yield* getSignal;
    assert.throws(() => fail(), caught => caught === error);
    assert.equal(failedSignal, signal);
    assert.equal(yield* getSignal, signal);
    try {
      yield* fail.schedulable();
      assert.fail("expected child failure");
    } catch (caught) {
      assert.equal(caught, error);
    }
    assert.equal(failedSignal, signal);
    assert.equal(yield* getSignal, signal);
    return signal;
  });

  const enclosing = parent();
  assert.notEqual(sync(getSignal), enclosing);
  assert.throws(() => fail(), caught => caught === error);
  assert.notEqual(sync(getSignal), failedSignal);
});

test("iterator acquisition failures release the synchronous run's signal", () => {
  const error = new Error("iterator failed");
  let failedSignal: ScheduleSignal | undefined;
  const iterable = (function* () {})();
  iterable[Symbol.iterator] = () => {
    failedSignal = sync(getSignal);
    throw error;
  };

  assert.throws(() => sync(iterable), caught => caught === error);
  assert.ok(failedSignal instanceof AbortSignal);
  assert.notEqual(sync(getSignal), failedSignal);
});

test("getSignal forwards abort event subscriptions to the supplied AbortSignal", async () => {
  const controller = new AbortController();
  const scheduled = new ScheduleController({ signal: controller.signal });
  const work = makeSchedulable(function* () {
    return yield* getSignal;
  });
  const signal = await async(work.schedulable(), { signal: scheduled.signal });
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
  assert.equal(await async(work.schedulable()), false);
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
  const pending = async(work.schedulable(), { signal: controller.signal });
  await assert.rejects(pending, { name: "AbortError" });
});

test("requesting a signal rejects an already aborted run", async () => {
  const controller = new AbortController();
  controller.abort();
  const work = makeSchedulable(function* () {
    return yield* getSignal;
  });
  await assert.rejects(async(work.schedulable(), { signal: controller.signal }), { name: "AbortError" });
});
