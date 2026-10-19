import assert from "node:assert/strict";
import test from "node:test";
import { async, commands, makeSchedulable } from "../src/index.ts";

test("execute iterators yield once, return the supplied result, and stay completed", () => {
  let calls = 0;
  const child = makeSchedulable(function* () { calls++; return 7; });
  for (const factory of [child.command, commands.execute(child)]) {
    const iterator = factory();
    assert.equal(iterator[Symbol.iterator](), iterator);
    assert.equal(iterator.next(99).done, false);
    assert.equal(calls, 0);
    assert.deepEqual(iterator.next(42), { value: 42, done: true });
    assert.deepEqual(iterator.next(8), { value: undefined, done: true });
  }
});

test("execute iterators close on return or throw, before or after yielding", () => {
  const factory = commands.execute(() => assert.fail("must not execute"));
  for (const started of [false, true]) {
    const returning = factory();
    if (started) returning.next();
    assert.deepEqual(returning.return(3), { value: 3, done: true });
    assert.deepEqual(returning.next(), { value: undefined, done: true });

    for (const error of [new Error("injected"), undefined]) {
      const throwing = factory();
      if (started) throwing.next();
      assert.throws(() => throwing.throw(error), caught => caught === error);
      assert.deepEqual(throwing.next(), { value: undefined, done: true });
    }
  }
});

test("all command iterators retain native iterator helpers and disposal", () => {
  const unexpected = () => assert.fail("must not execute");
  const cases = [
    [commands.execute(unexpected), "execute"],
    [commands.getSignal, "getSignal"],
    [commands.yieldNow, "yield"],
    [commands.syncAware({ sync: unexpected, async: unexpected }), "syncAware"],
  ] as const;
  for (const [factory, kind] of cases) {
    const iterator = factory();
    assert.deepEqual(iterator.map(command => command.kind).toArray(), [kind]);
    const disposed = factory();
    disposed[Symbol.dispose]();
    assert.deepEqual(disposed.next(), { value: undefined, done: true });
  }
});

test("command yields before entering its child when the deadline expires", async () => {
  let entered = 0;
  let expired = true;
  let bumps = 0;
  const signal = {
    aborted: false,
    throwIfAborted() {},
    get shouldYield() { return expired; },
    bump() { expired = false; bumps++; },
  };
  const child = makeSchedulable(function* () { entered++; return 7; });
  const parent = makeSchedulable(function* () { return yield* child.command(); });
  const promise = async(parent, signal)();
  assert.equal(entered, 0);
  assert.equal(await promise, 7);
  assert.equal(bumps, 1);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(async(parent, controller.signal)());
  assert.equal(entered, 1);
});
