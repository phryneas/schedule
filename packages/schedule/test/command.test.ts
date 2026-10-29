import assert from "node:assert/strict";
import test from "node:test";
import { async, makeSchedulable, commands } from "../src/index.ts";

test("command is cached and reusable across receivers and scheduler runs", async () => {
  const add = makeSchedulable(function* (this: { base: number }, value: number) {
    yield* commands.yieldNow;
    return this.base + value;
  });
  assert.equal(add.schedulable, add.schedulable);
  assert.equal(Object.prototype.propertyIsEnumerable.call(add, "schedulable"), false);
  const call = add.schedulable.bind({ base: 10 });
  const work = makeSchedulable(function* (value: number) {
    return [yield* call(value), yield* add.schedulable.bind({ base: 20 })(value + 1)];
  });
  assert.deepEqual(work(1), [11, 22]);
  assert.deepEqual(await Promise.all([async(work.schedulable(2)), async(work.schedulable(3))]), [[12, 23], [13, 24]]);
});

test("command preserves execute error propagation", async () => {
  const fail = makeSchedulable(function* () { throw new Error("failure"); });
  const work = makeSchedulable(function* () {
    try { yield* fail.schedulable(); }
    catch (error) { return (error as Error).message; }
  });
  assert.equal(work(), "failure");
  assert.equal(await async(work.schedulable()), "failure");
});
