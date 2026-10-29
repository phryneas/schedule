import assert from "node:assert/strict";
import test from "node:test";
import { async, emit, execute, makeSchedulable, sync, syncAware, yieldNow } from "../src/index.ts";

for (const scheduler of [sync, async]) {
  test(`${scheduler.name}: emits child values in order and preserves the final result`, async () => {
    const events: unknown[] = [];
    const child = makeSchedulable(function* () {
      assert.equal(yield* emit(2), undefined);
      yield* yieldNow;
      yield* emit(3);
      return 42;
    });
    const parent = makeSchedulable(function* () {
      yield* emit(1);
      const result = yield* execute(child)();
      events.push("resumed");
      return result;
    });
    assert.equal(await scheduler(parent.schedulable(), {
      onValue(value) { events.push(value); return "ignored"; },
    }), 42);
    assert.deepEqual(events, [1, 2, 3, "resumed"]);
  });

  test(`${scheduler.name}: drops values without a callback`, async () => {
    function* work() {
      assert.equal(yield* emit(1), undefined);
      yield* emit(undefined);
      return 42;
    }
    assert.equal(await scheduler(work()), 42);
  });

  test(`${scheduler.name}: callback errors reach generator catch and finally`, async () => {
    const reason = new Error("callback failed");
    let closed = false;
    function* work() {
      try {
        yield* emit(1);
        assert.fail("must throw at emit");
      } catch (error) {
        assert.equal(error, reason);
        return 42;
      } finally {
        closed = true;
      }
    }
    assert.equal(await scheduler(work(), { onValue() { throw reason; } }), 42);
    assert.equal(closed, true);
  });

  test(`${scheduler.name}: emits promises as values without awaiting them`, async () => {
    const promise = new Promise<never>(() => {});
    function* work() { yield* emit(promise); return 42; }
    const values: unknown[] = [];
    assert.equal(await scheduler(work(), { onValue(value) { values.push(value); } }), 42);
    assert.deepEqual(values, [promise]);
  });
}

test("async delivers partial results before a pending operation completes", async () => {
  const operation = Promise.withResolvers<number>();
  const values: number[] = [];
  function* work() {
    yield* emit(1);
    const result = yield* syncAware({ sync: () => 42, async: () => operation.promise, startImmediately: true })();
    yield* emit(result);
    return "done";
  }
  const pending = async(work(), { startImmediately: true, onValue(value) { values.push(value); } });
  assert.deepEqual(values, [1]);
  operation.resolve(42);
  assert.equal(await pending, "done");
  assert.deepEqual(values, [1, 42]);
});

test("async runs keep their emission callbacks isolated", async () => {
  const work = makeSchedulable(function* (value: number) {
    yield* emit(value);
    yield* yieldNow;
    yield* emit(value + 1);
  });
  const first: number[] = [], second: number[] = [];
  await Promise.all([
    async(work.schedulable(1), { onValue(value) { first.push(value); } }),
    async(work.schedulable(10), { onValue(value) { second.push(value); } }),
  ]);
  assert.deepEqual(first, [1, 2]);
  assert.deepEqual(second, [10, 11]);
});

test("cancellation from onValue stops further emissions and closes the generator", async () => {
  const controller = new AbortController();
  const values: number[] = [];
  let closed = false;
  function* work() {
    try {
      yield* emit(1);
      yield* emit(2);
    } finally { closed = true; }
  }
  await assert.rejects(async(work(), {
    signal: controller.signal,
    onValue(value) { values.push(value); controller.abort(); },
  }), { name: "AbortError" });
  assert.deepEqual(values, [1]);
  assert.equal(closed, true);
});
