import assert from "node:assert/strict";
import test from "node:test";
import { async, commands, makeSchedulable } from "../src/index.ts";

test("signal and yield commands can be reused across synchronous invocations", () => {
  const work = makeSchedulable(function* () {
    const before = yield* commands.getSignal;
    assert.equal(yield* commands.yieldNow, undefined);
    assert.equal(yield* commands.yieldNow, undefined);
    return [before, yield* commands.getSignal];
  });
  for (let i = 0; i < 3; i++) {
    const [before, after] = work();
    assert.equal(before, after);
    assert.equal(before.shouldYield, false);
  }
});

test("yield requests and completions are shared, without affecting signal results", () => {
  const yielding = commands.yieldNow;
  const request = yielding.next();
  const completion = yielding.next(null);
  assert.deepEqual(completion, { done: true, value: undefined });
  assert.equal(yielding.next(), request);
  assert.equal(yielding.next(null), completion);

  const signal = makeSchedulable(function* () {
    return yield* commands.getSignal;
  })();
  const first = commands.getSignal.next(signal);
  commands.getSignal.return(signal);
  assert.deepEqual(first, { done: true, value: signal });
  assert.equal(commands.getSignal.next().done, false);
});

test("bounded iterator helpers and disposal leave reusable commands usable", () => {
  for (const command of [commands.getSignal, commands.yieldNow]) {
    const iterator = command;
    assert.equal(iterator.take(1).toArray().length, 1);
    iterator[Symbol.dispose]();
    assert.equal(iterator.next().done, false);
  }
});

test("overlapping asynchronous runs retain their own signals across yields", async () => {
  const signals = Array.from({ length: 5 }, () => ({
    aborted: false,
    shouldYield: false,
    throwIfAborted() {},
    bumps: 0,
    bump() { this.bumps++; },
  }));
  const work = makeSchedulable(function* () {
    const before = yield* commands.getSignal;
    for (let i = 0; i < 3; i++) {
      assert.equal(yield* commands.yieldNow, undefined);
      assert.equal(yield* commands.getSignal, before);
    }
    return before;
  });
  const results = await Promise.all(signals.map(signal => async(work, { signal })()));
  signals.forEach((signal, i) => {
    assert.equal(results[i], signal);
    assert.equal(signal.bumps, 3);
  });
});

test("cancellation during getSignal does not poison later uses", async () => {
  const work = makeSchedulable(function* () {
    return yield* commands.getSignal;
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(async(work, { signal: controller.signal })());
  assert.equal((await async(work)()).aborted, false);
});

test("closing or throwing into a delegated command does not affect another use", () => {
  for (const command of [commands.getSignal, commands.yieldNow]) {
    function* delegate() { return yield* command; }
    const first = delegate();
    const second = delegate();
    assert.equal(first.next().done, false);
    assert.equal(second.next().done, false);
    const error = new Error("stop");
    assert.throws(() => first.throw(error), error);
    assert.deepEqual(second.return(undefined), { done: true, value: undefined });
    assert.equal(delegate().next().done, false);
  }
});
