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

test("nested scheduler calls do not change the outer signal", async () => {
  const child = makeSchedulable(function* (): SchedulableIterable<number> {
    return 42;
  });
  function check() {
    assert.equal(child(), 42);
  }
  const parent = makeSchedulable(function* (): SchedulableIterable<void> {
    const signal = yield* getSignal();
    check();
    yield* execute(check)();
    yield* syncAware({
      sync: check,
      async: async () => { assert.equal(await async(child)(), 42); },
    })();
    assert.equal(yield* getSignal(), signal);
  });

  parent();
  await async(parent)();
});

test("execute composition preserves safe generator execution in both modes", async () => {
  const child = makeSchedulable(function* (): SchedulableIterable<number> {
    yield* getSignal();
    yield* yieldNow();
    return 42;
  });
  const parent = makeSchedulable(function* (): SchedulableIterable<number> {
    const signal = yield* getSignal();
    const result = yield* execute(child)();
    assert.equal(yield* getSignal(), signal);
    return result;
  });

  assert.equal(parent(), 42);
  assert.equal(await async(parent)(), 42);
});
