import assert from "node:assert/strict";
import test from "node:test";
import { transformSource } from "../src/index.ts";

test("simple functions and methods are left unchanged", () => {
  const source = `export function identity<T>(value: T): T {
  return value;
}

export const twice = (value: number) => value * 2;

export class Counter {
  value = 0;
  increment() { return ++this.value; }
}
`;
  assert.equal(transformSource(source, "fixture.ts"), source);
});

test("functions without generated yields remain unchanged", () => {
  const bodies = [
    "for (let i = 0; i < 2; i++) {}",
    "for (const value of values) {}",
    "for (const key in values) {}",
    "while (values.length) { values.length--; }",
    "do { values.length--; } while (values.length);",
    "return helper();",
    "return new Helper();",
    "return tag`text`;",
  ];
  for (const body of bodies) {
    const source = `export function work() { ${body} }`;
    assert.equal(transformSource(source, "fixture.ts"), source, body);
  }
});

test("loops and calls in nested functions do not make the containing function complex", () => {
  const source = `export function factory() {
  return function worker() {
    while (true) { helper(); }
  };
}
`;
  const output = transformSource(source, "fixture.ts");
  assert.match(output, /export function factory\(\)/);
  assert.doesNotMatch(output, /var factory = _makeSchedulable/);
});

test("inline callbacks remain unchanged even when they contain calls or loops", () => {
  const callbacks = [
    "value => helper(value)",
    "function (value) { while (value > 0) value = helper(value); return value; }",
  ];
  for (const callback of callbacks) {
    const output = transformSource(`export function work(values) { return values.map(${callback}); }`, "fixture.ts");
    assert.ok(output.includes(callback));
    assert.equal((output.match(/_makeSchedulable\(/g) ?? []).length, 1);
  }
  const named = transformSource("function helper(value) { return value; }\nexport const work = value => helper(value);", "fixture.ts");
  assert.match(named, /const work = _makeSchedulable/);
});

test("only module-level definitions and class members are wrapped", () => {
  const nested = "function nested() { return helper(); }";
  const local = "const local = () => helper();";
  const object = "const object = { method() { return helper(); }, arrow: () => helper() };";
  const output = transformSource(`
    function helper() { return 1; }
    export function outer() {
      ${nested}
      ${local}
      return nested() + local();
    }
    ${object}
    export const named = () => helper();
    export default function () { return helper(); }
    export class Worker {
      method() { return helper(); }
      field = function () { return helper(); };
    }
  `, "fixture.ts");
  assert.ok(output.includes(nested));
  assert.ok(output.includes(local));
  assert.ok(output.includes(object));
  assert.match(output, /var outer = _makeSchedulable/);
  assert.match(output, /const named = _makeSchedulable/);
  assert.match(output, /var _default = _makeSchedulable/);
  assert.match(output, /field = _makeSchedulable/);
  assert.match(output, /Object\.defineProperty\(this\.prototype, "method"/);
  assert.equal((output.match(/_makeSchedulable\(/g) ?? []).length, 5);
});
