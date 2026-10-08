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

test("both schedulers reject nested entry in generators and callbacks", async () => {
  const child = makeSchedulable(function* (): SchedulableIterable<number> {
    return 42;
  });
  function check() {
    assert.throws(() => child(), /Cannot start a scheduler inside a scheduler/);
    assert.throws(
      () => async(child)(),
      /Cannot start a scheduler inside a scheduler/,
    );
  }
  const parent = makeSchedulable(function* (): SchedulableIterable<void> {
    check();
    yield* execute(check, undefined, []);
    yield* syncAware({ sync: check, async: async () => check(), args: [] });
  });

  parent();
  await async(parent)();
  assert.throws(() => getSignal(), /synchronous scheduler execution/);
});

test("execute composition preserves safe generator execution in both modes", async () => {
  const child = makeSchedulable(function* (): SchedulableIterable<number> {
    getSignal();
    yield yieldNow;
    return 42;
  });
  const parent = makeSchedulable(function* (): SchedulableIterable<number> {
    const signal = getSignal();
    const result = yield* execute(child, undefined, []);
    assert.equal(getSignal(), signal);
    return result;
  });

  assert.equal(parent(), 42);
  assert.equal(await async(parent)(), 42);
});
