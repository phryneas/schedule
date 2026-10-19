import assert from "node:assert/strict";
import test from "node:test";
import { transformSource } from "../src/index.ts";

test("synchronous calls retain surrounding checkpoints and scheduled arguments", () => {
  const result = transformSource(`export function run(fn: (x: number) => number, input: () => number) {
    // @phryneas/schedule may-yield-here
    // @phryneas/schedule synchronous
    return fn(input());
  }`, "fixture.ts");
  assert.match(result, /yield\* _commands.yieldNow\(\)/);
  assert.match(result, /return fn\([^]*?_scheduled = _schedulableImplementationSignal in input, _scheduled \? yield\* _commands.execute\(input\)\(\) : input\(\)/);
  assert.doesNotMatch(result, /execute\(fn\)/);
});

test("synchronous supports assignments, declarations, optional calls, and inline call comments", () => {
  const result = transformSource(`export function run(fn: any, obj: any) {
    // @phryneas/schedule may-yield-here
    // @phryneas/schedule synchronous
    const first = fn.call(obj, 1);
    let second;
    // @phryneas/schedule synchronous
    second = fn.apply(obj, [first]);
    // @phryneas/schedule synchronous
    fn?.(second);
    return /* @phryneas/schedule synchronous */ fn(second);
  }`, "fixture.ts");
  assert.match(result, /fn.call\(obj, 1\)/);
  assert.match(result, /fn.apply\(obj, \[first\]\)/);
  assert.match(result, /fn\?\.\(second\)/);
  assert.doesNotMatch(result, /execute\(/);
});

test("a synchronous call alone does not make a function schedulable", () => {
  const result = transformSource(`export function run(fn: () => number) {
    // @phryneas/schedule synchronous
    return fn();
  }`, "fixture.ts");
  assert.doesNotMatch(result, /makeSchedulable/);
});

test("misplaced synchronous markers are rejected", () => {
  assert.throws(() => transformSource(`export function run() {
    // @phryneas/schedule synchronous
    return 42;
  }`, "fixture.ts"), /synchronous must immediately precede/);
});
