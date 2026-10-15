import assert from "node:assert/strict";
import test from "node:test";
import { transformSource } from "../src/index.ts";
import { async as scheduled } from "../../schedule/src/index.ts";
import { schedulableImplementationSignal } from "../../schedule/src/internal.ts";

const runtimeModule = new URL("../../schedule/src/index.ts", import.meta.url).href;

test("directives make a loop schedulable and yield at the marked positions", async () => {
  const output = transformSource(`export function sum(values) {
  let total = 0;
  for (const value of values) {
    total += value;
    // Keep this ordinary comment.
    // @phryneas/schedule may-yield-here
  }
  return total;
}
`, "fixture.js", { runtimeModule });
  assert.doesNotMatch(output, /may-yield-here/);
  assert.match(output, /Keep this ordinary comment/);
  assert.match(output, /if \(_signal.shouldYield\)/);
  const module = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
  assert.equal(module.sum([1, 2, 3]), 6);
  assert.equal(await scheduled(module.sum)([1, 2, 3]), 6);
  for (const shouldYield of [false, true]) {
    const iterator = module.sum[schedulableImplementationSignal]([1, 2, 3]);
    assert.deepEqual(iterator.next().value, { kind: "getSignal" });
    let step = iterator.next({ shouldYield });
    let yields = 0;
    while (!step.done) {
      assert.deepEqual(step.value, { kind: "yield" });
      yields++;
      step = iterator.next();
    }
    assert.equal(step.value, 6);
    assert.equal(yields, shouldYield ? 3 : 0);
  }
});

test("multiple checkpoints share a signal and avoid existing variable names", () => {
  const output = transformSource(`export function work(signal, _signal) {
  // @phryneas/schedule may-yield-here
  if (signal) {
    // @phryneas/schedule may-yield-here
  }
  // @phryneas/schedule may-yield-here
  return _signal;
}`, "fixture.js");
  assert.equal((output.match(/\.getSignal\(\)/g) ?? []).length, 1);
  assert.equal((output.match(/\.yieldNow\(\)/g) ?? []).length, 3);
  assert.match(output, /const _signal2 = yield\*/);
});

test("directives in excluded functions and unsupported positions report errors", () => {
  const sources = [
    "// @phryneas/schedule may-yield-here\nconst value = 1;",
    "function work() { return [1].map(value => {\n// @phryneas/schedule may-yield-here\nreturn value; }); }",
    "async function work() {\n// @phryneas/schedule may-yield-here\n}",
    "function* work() {\n// @phryneas/schedule may-yield-here\n}",
    "function work() { const value = (\n// @phryneas/schedule may-yield-here\n1); }",
    "function work() { const value = 1; // @phryneas/schedule may-yield-here\n}",
  ];
  for (const source of sources) assert.throws(() => transformSource(source, "fixture.js"), /may-yield-here/);
});

test("directives work in named arrows and class methods", async () => {
  const output = transformSource(`
export const work = () => {
  // @phryneas/schedule may-yield-here
  return 3;
};
export class Worker {
  value = 4;
  run() {
    // @phryneas/schedule may-yield-here
    return this.value;
  }
}
`, "fixture.js", { runtimeModule });
  const module = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
  assert.equal(module.work(), 3);
  assert.equal(await scheduled(module.work)(), 3);
  const worker = new module.Worker();
  assert.equal(worker.run(), 4);
  assert.equal(await scheduled(worker.run).call(worker), 4);
});
