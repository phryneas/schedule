import assert from "node:assert/strict";
import test from "node:test";
import { transformSource } from "../src/index.ts";

test("consumes all scheduling directives after transformation, preserving ordinary comments", () => {
  const output = transformSource(`// @phryneas/schedule explicit
/** Public documentation. */
// @phryneas/schedule schedulable
export function work(items: number[], callback: (value: number) => number) {
  // Keep this explanation.
  // @phryneas/schedule transform-to-loop
  const result = items.map(item => {
    // @phryneas/schedule may-yield-here
    return callback(item);
  });
  // @phryneas/schedule synchronous
  return finish(result);
}
function factory() {
  return /* @phryneas/schedule schedulable */ function nested() { return 1; };
}
function plain() {
  // @phryneas/schedule explicit
  return finish([]);
}
// Trailing explanation.
`, "fixture.ts");
  assert.doesNotMatch(output, /@phryneas\/schedule (?:explicit|schedulable|synchronous|may-yield-here|transform-to-loop)/);
  assert.match(output, /Public documentation/);
  assert.match(output, /Keep this explanation/);
  assert.match(output, /Trailing explanation/);
  assert.match(output, /for \(const item of/);
  assert.match(output, /yield\* _commands.yieldNow/);
  assert.match(output, /yield\* _commands.execute\(callback\)/);
  assert.match(output, /return finish\(result\)/);
});

test("removes directives even when the source needs no scheduling transformation", () => {
  const output = transformSource(`// Ordinary header.
// @phryneas/schedule explicit
export function work() {
  // Ordinary body comment.
  return external();
}`, "fixture.ts");
  assert.doesNotMatch(output, /@phryneas\/schedule/);
  assert.match(output, /Ordinary header/);
  assert.match(output, /Ordinary body comment/);
  assert.match(output, /return external\(\)/);
});
