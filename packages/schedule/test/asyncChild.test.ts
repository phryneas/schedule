import assert from "node:assert/strict";
import test from "node:test";
import { async, commands, makeSchedulable } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

test("immediate children return values and preserve receivers", async () => {
  const receiver = { value: 4 };
  const child = makeSchedulable(function* (this: typeof receiver, amount: number) {
    return this.value + amount;
  });
  const parent = makeSchedulable(function* () {
    return yield* child.command.call(receiver, 3);
  });
  assert.equal(await async(parent)(), 7);
});

test("a child's first command is processed exactly once with the shared signal", async () => {
  let calls = 0;
  const child = makeSchedulable(function* () {
    calls++;
    const signal = yield* commands.getSignal;
    yield* commands.yieldNow;
    return signal;
  });
  const parent = makeSchedulable(function* () {
    const signal = yield* commands.getSignal;
    assert.equal(yield* child.command(), signal);
  });
  await async(parent)();
  assert.equal(calls, 1);
});

test("immediate children assimilate promises and read then getters once", async () => {
  let reads = 0;
  const object = {
    get then() {
      reads++;
      return undefined;
    },
  };
  const child = makeSchedulable(function* (value: unknown): SchedulableIterable<unknown> {
    return value;
  });
  const parent = makeSchedulable(function* () {
    assert.equal(yield* child.command(Promise.resolve(42)), 42);
    assert.equal(yield* child.command(object), object);
    assert.equal(reads, 1);
  });
  await async(parent)();
});

test("immediate child throws and promise rejections reach parent catch and finally", async () => {
  const error = new Error("child failure");
  for (const reject of [false, true]) {
    let finalized = false;
    const child = makeSchedulable(function* () {
      if (reject) return Promise.reject(error);
      throw error;
    });
    const parent = makeSchedulable(function* () {
      try {
        yield* child.command();
        assert.fail("expected child failure");
      } catch (caught) {
        assert.equal(caught, error);
      } finally {
        finalized = true;
      }
    });
    await async(parent)();
    assert.equal(finalized, true);
  }
});
