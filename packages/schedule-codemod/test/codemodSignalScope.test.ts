import assert from "node:assert/strict";
import test from "node:test";
import { transformSource } from "../src/index.ts";
import { schedulableImplementationSymbol } from "../../schedule/src/index.ts";

const runtimeModule = new URL("../../schedule/src/index.ts", import.meta.url).href;

test("unconditional function-level checkpoints use eager acquisition", () => {
  for (const body of [
    `fn.call(null); return 7;`,
    `const value = 7; fn.call(null); return value;`,
    `return fn.call(null);`,
    `if (fn.call(null)) return 7;`,
    `// @phryneas/schedule may-yield-here\nreturn 7;`,
  ]) {
    const output = transformSource(`export function work(fn) {\n${body}\n}`, "fixture.js");
    assert.match(output, /const _signal = yield\* _commands.getSignal/);
    assert.doesNotMatch(output, /\?\?=/);
  }
});

test("early returns and conditional expressions keep acquisition lazy", async () => {
  for (const body of [
    `if (!kind) return 7; fn.call(null); return 7;`,
    `kind && fn.call(null); return 7;`,
    `kind ? fn.call(null) : 7; return 7;`,
    `kind &&= fn.call(null); return 7;`,
  ]) {
    const work = await generator(body);
    assert.deepEqual(work(false, () => 3).next(), { done: true, value: 7 });
    assert.deepEqual(work(true, () => 3).next().value, { kind: "getSignal" });
  }
});
async function generator(body: string) {
  const output = transformSource(`export function work(kind, fn) { ${body} }`, "fixture.js", { runtimeModule });
  const module = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
  return module.work[schedulableImplementationSymbol];
}

test("computed keys initialize the signal for the following assignment value", async () => {
  const output = transformSource(`export function map(list, keyFn, valFn) {
    const result = {};
    for (const item of list) {
      result[keyFn(item)] = valFn(item);
    }
    return result;
  }`, "fixture.js", { runtimeModule });
  assert.equal((output.match(/\?\?=/g) ?? []).length, 1);
  const module = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
  const iterator = module.map[schedulableImplementationSymbol]([1, 2], String, (n: number) => n * 2);
  assert.deepEqual(iterator.next().value, { kind: "getSignal" });
  assert.deepEqual(iterator.next({ shouldYield: false }), { done: true, value: { 1: 2, 2: 4 } });
});

test("successive statements in a loop share initialization but conditional ones do not", async () => {
  for (const [first, expected] of [
    ['fn.call(null);', 1],
    ['if (kind) fn.call(null);', 2],
    ['kind && fn.call(null);', 2],
  ] as const) {
    const output = transformSource(`export function work(kind, fn) {
      for (let i = 0; i < 2; i++) {
        ${first}
        fn.call(null);
      }
    }`, "fixture.js", { runtimeModule });
    assert.equal((output.match(/\?\?=/g) ?? []).length, expected);
    const module = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
    const iterator = module.work[schedulableImplementationSymbol](false, () => {});
    assert.deepEqual(iterator.next().value, { kind: "getSignal" });
    assert.deepEqual(iterator.next({ shouldYield: false }), { done: true, value: undefined });
  }
});

test("destructuring does not assume its computed key runs before its source", async () => {
  const work = await generator(`if (kind) {
    const { [fn.call(null)]: value } = fn.call(null);
    return value;
  }`);
  const values = [{ key: 7 }, 'key'];
  const iterator = work(true, () => values.shift());
  assert.deepEqual(iterator.next().value, { kind: "getSignal" });
  assert.deepEqual(iterator.next({ shouldYield: false }), { done: true, value: 7 });
});

test("signal acquisition stays inside the switch branch using it", async () => {
  const work = await generator(`switch (kind) {
    case 'call': { return fn.call(null); }
    default: return 7;
  }`);
  assert.deepEqual(work('skip', () => 3).next(), { done: true, value: 7 });
  const iterator = work('call', () => 3);
  assert.deepEqual(iterator.next().value, { kind: "getSignal" });
  assert.deepEqual(iterator.next({ shouldYield: false }), { done: true, value: 3 });
});

test("a branch containing a loop acquires its signal only once", async () => {
  const work = await generator(`if (kind) {
    for (let i = 0; i < 3; i++) {
      // @phryneas/schedule may-yield-here
    }
  } return 7;`);
  assert.deepEqual(work(false).next(), { done: true, value: 7 });
  const iterator = work(true);
  assert.deepEqual(iterator.next().value, { kind: "getSignal" });
  assert.deepEqual(iterator.next({ shouldYield: true }).value, { kind: 'yield' });
  assert.deepEqual(iterator.next(null).value, { kind: 'yield' });
  assert.deepEqual(iterator.next(null).value, { kind: 'yield' });
  assert.deepEqual(iterator.next(null), { done: true, value: 7 });
});

test("checks in separate branches lazily share a function-level signal", async () => {
  const work = await generator(`if (kind === 1) { fn.call(null); }
    if (kind === 2) { fn.call(null); }
    return 7;`);
  assert.deepEqual(work(0).next(), { done: true, value: 7 });
  for (const kind of [1, 2]) {
    const iterator = work(kind, () => 3);
    assert.deepEqual(iterator.next().value, { kind: "getSignal" });
    assert.deepEqual(iterator.next({ shouldYield: false }), { done: true, value: 7 });
  }
});

test("a branch inside a loop does not reacquire the signal per iteration", async () => {
  const work = await generator(`for (let i = 0; i < 3; i++) {
    if (kind) { fn.call(null); }
  } return 7;`);
  let calls = 0;
  const iterator = work(true, () => { calls++; });
  assert.deepEqual(iterator.next().value, { kind: "getSignal" });
  assert.deepEqual(iterator.next({ shouldYield: false }), { done: true, value: 7 });
  assert.equal(calls, 3);
});

test("signal acquisition does not move into a catchable region", async () => {
  const work = await generator(`try {
    if (kind) { return fn.call(null); }
  } catch { return 'caught'; }`);
  const iterator = work(true, () => 3);
  assert.deepEqual(iterator.next().value, { kind: "getSignal" });
  const error = new Error('cancelled');
  assert.throws(() => iterator.throw(error), value => value === error);
});

test("signal acquisition stays outside nested try, catch, and finally blocks", async () => {
  for (const body of [
    `try { try { fn.call(null); } catch {} } catch { return 'caught'; }`,
    `try { throw 1; } catch { fn.call(null); }`,
    `try { return 7; } finally { fn.call(null); }`,
  ]) {
    let calls = 0;
    const work = await generator(body);
    const iterator = work(true, () => { calls++; });
    assert.deepEqual(iterator.next().value, { kind: "getSignal" });
    const error = new Error('cancelled');
    assert.throws(() => iterator.throw(error), value => value === error);
    assert.equal(calls, 0);
  }
});
