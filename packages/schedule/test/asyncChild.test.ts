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

test("non-immediate primitive results resume the parent without awaiting", async () => {
  const events: string[] = [];
  const child = makeSchedulable(function* () {
    yield* commands.getSignal;
    queueMicrotask(() => events.push("microtask"));
    return 42;
  });
  const parent = makeSchedulable(function* () {
    assert.equal(yield* child.command(), 42);
    events.push("parent");
  });
  await async(parent)();
  assert.deepEqual(events, ["parent", "microtask"]);
});

test("non-immediate child failures reach the parent without awaiting", async () => {
  const events: string[] = [];
  const error = new Error("child failure");
  const child = makeSchedulable(function* () {
    yield* commands.getSignal;
    queueMicrotask(() => events.push("microtask"));
    throw error;
  });
  const parent = makeSchedulable(function* () {
    try {
      yield* child.command();
    } catch (caught) {
      assert.equal(caught, error);
      events.push("parent");
    }
  });
  await async(parent)();
  assert.deepEqual(events, ["parent", "microtask"]);
});

test("nested errors unwind through yielding finally blocks", async () => {
  const error = new Error("nested failure");
  const events: number[] = [];
  const child = makeSchedulable(function* (depth: number): SchedulableIterable<void> {
    try {
      yield* commands.getSignal;
      if (depth === 0) throw error;
      yield* child.command(depth - 1);
    } finally {
      yield* commands.yieldNow;
      events.push(depth);
    }
  });
  const parent = makeSchedulable(function* () {
    try {
      yield* child.command(3);
    } catch (caught) {
      assert.equal(caught, error);
      events.push(4);
    }
  });
  await async(parent)();
  assert.deepEqual(events, [0, 1, 2, 3, 4]);
});

test("a rejection returned after a child command reaches its parent", async () => {
  const error = new Error("returned rejection");
  const child = makeSchedulable(function* () {
    yield* commands.getSignal;
    return Promise.reject(error);
  });
  const parent = makeSchedulable(function* () {
    try {
      yield* child.command();
      assert.fail("expected rejection");
    } catch (caught) {
      assert.equal(caught, error);
      return 42;
    }
  });
  assert.equal(await async(parent)(), 42);
});

test("non-immediate children read a returned object's then getter once", async () => {
  let reads = 0;
  const value = {
    get then() {
      reads++;
      return undefined;
    },
  };
  const child = makeSchedulable(function* () {
    yield* commands.getSignal;
    return value;
  });
  const parent = makeSchedulable(function* () {
    assert.equal(yield* child.command(), value);
    assert.equal(reads, 1);
  });
  await async(parent)();
});

test("deep scheduled child calls do not exhaust the JavaScript call stack", async () => {
  const child = makeSchedulable(function* (depth: number): SchedulableIterable<number> {
    if (depth === 0) return 0;
    return 1 + (yield* child.command(depth - 1));
  });
  assert.equal(await async(child)(10_000), 10_000);
});

for (const immediate of [true, false]) {
  test(`${immediate ? "immediate" : "non-immediate"} children only await thenables`, async () => {
    const child = makeSchedulable(function* (value: unknown): SchedulableIterable<unknown> {
      if (!immediate) yield* commands.getSignal;
      return value;
    });
    const values = [undefined, null, 42, {}, () => {}, { then: 42 }];
    let finished = false;
    const parent = makeSchedulable(function* () {
      for (const value of values) {
        assert.equal(yield* child.command(value), value);
      }
      finished = true;
    });
    const signal = {
      aborted: false,
      shouldYield: false,
      throwIfAborted() {},
      bump() {},
    };
    const pending = async(parent, signal)();
    assert.equal(finished, true);
    await pending;

    const thenable = {
      then(resolve: (value: number) => void) {
        assert.equal(this, thenable);
        resolve(42);
      },
    };
    const callableThenable = Object.assign(() => {}, {
      then(resolve: (value: number) => void) { resolve(17); },
    });
    const error = new Error("then getter failed");
    const throwing = {
      get then(): never { throw error; },
    };
    const assimilate = makeSchedulable(function* () {
      assert.equal(yield* child.command(thenable), 42);
      assert.equal(yield* child.command(callableThenable), 17);
      try {
        yield* child.command(throwing);
        assert.fail("expected getter failure");
      } catch (caught) {
        assert.equal(caught, error);
      }
    });
    await async(assimilate, signal)();
  });
}
