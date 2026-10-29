import assert from "node:assert/strict";
import test from "node:test";
import {
  async,
  execute,
  getSignal,
  makeSchedulable,
  syncAware,
  yieldNow,
} from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

for (const options of [undefined, {}, { startImmediately: true }, { startImmediately: false }]) {
  test(`async entry timing with options ${JSON.stringify(options)}`, async () => {
    const events: string[] = [];
    const work = makeSchedulable(function (this: { base: number }, value: number) {
      events.push("create");
      const result = this.base + value;
      return (function* () {
        events.push("run");
        return result;
      })();
    });
    const iterable = work.schedulable.call({ base: 40 }, 2);
    assert.deepEqual(events, []);
    const pending = async(iterable, options);
    const beforeYield = options?.startImmediately ? ["create", "run"] : [];
    assert.deepEqual(events, beforeYield);
    await Promise.resolve();
    assert.deepEqual(events, beforeYield);
    assert.equal(await pending, 42);
    assert.deepEqual(events, ["create", "run"]);
  });
}

test("deferred entry observes cancellation before its first signal acquisition", async () => {
  const controller = new AbortController();
  let finished = false;
  const work = makeSchedulable(function* () {
    yield* getSignal;
    finished = true;
  });
  const pending = async(work.schedulable(), {
    signal: controller.signal,
    startImmediately: false,
  });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(finished, false);
});

test("deferred entry rejects errors thrown while creating the iterable", async () => {
  const error = new Error("factory failed");
  const work = makeSchedulable(function (): SchedulableIterable<never> {
    throw error;
  });
  const pending = async(work.schedulable(), { startImmediately: false });
  await assert.rejects(pending, reason => reason === error);
});

test("async rejects errors thrown while creating the iterable", async () => {
  const error = new Error("parameter initialization failed");
  function fail(): never {
    throw error;
  }
  const defaultParameter = makeSchedulable(function* (
    value: number = fail(),
  ): SchedulableIterable<number> {
    return value;
  });
  const factory = makeSchedulable(function (): SchedulableIterable<number> {
    throw undefined;
  });

  // Invoke before assert.rejects so a synchronous throw fails the test.
  const parameterResult = async(defaultParameter.schedulable(), { startImmediately: true });
  await assert.rejects(parameterResult, reason => reason === error);
  const factoryResult = async(factory.schedulable(), { startImmediately: true });
  await assert.rejects(factoryResult, reason => reason === undefined);
});

test("nested scheduler calls do not change the outer signal", async () => {
  const child = makeSchedulable(function* (): SchedulableIterable<number> {
    return 42;
  });
  function check() {
    assert.equal(child(), 42);
  }
  const parent = makeSchedulable(function* (): SchedulableIterable<void> {
    const signal = yield* getSignal;
    check();
    yield* execute(check)();
    yield* syncAware({
      sync: check,
      async: async () => { assert.equal(await async(child.schedulable()), 42); },
    })();
    assert.equal(yield* getSignal, signal);
  });

  parent();
  await async(parent.schedulable());
});

test("execute composition preserves safe generator execution in both modes", async () => {
  const child = makeSchedulable(function* (): SchedulableIterable<number> {
    yield* getSignal;
    yield* yieldNow;
    return 42;
  });
  const parent = makeSchedulable(function* (): SchedulableIterable<number> {
    const signal = yield* getSignal;
    const result = yield* execute(child)();
    assert.equal(yield* getSignal, signal);
    return result;
  });

  assert.equal(parent(), 42);
  assert.equal(await async(parent.schedulable()), 42);
});
