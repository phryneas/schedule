import assert from "node:assert/strict";
import test from "node:test";
import { getSignal, makeSchedulable, sync, syncAware, yieldNow } from "../src/index.ts";

test("direct iterable executes commands synchronously", () => {
  function* work() {
    assert.equal((yield* getSignal).shouldYield, false);
    yield* yieldNow;
    return yield* syncAware({
      sync: () => 42,
      async: () => { throw new Error("unexpected async execution"); },
    })();
  }
  assert.equal(sync(work()), 42);
});

test("direct command iterable preserves arguments and receiver", () => {
  const work = makeSchedulable(function* (this: { base: number }, value: number) {
    return this.base + value;
  });
  assert.equal(sync(work.schedulable.call({ base: 40 }, 2)), 42);
});

test("direct iterable preserves returned promise identity", () => {
  const promise = Promise.resolve(42);
  function* work() { return promise; }
  assert.equal(sync(work()), promise);
});

test("direct iterable throws generator errors synchronously", () => {
  const reason = new Error("failed");
  function* work() { throw reason; }
  assert.throws(() => sync(work()), error => error === reason);
});
