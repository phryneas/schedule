import assert from "node:assert/strict";
import test from "node:test";
import { transformSource } from "../src/index.ts";

test("marked object methods are wrapped even without yields", () => {
  const result = transformSource(`export function factory() {
    return {
      // @phryneas/schedule schedulable
      run(value: number): number { return value; },
      plain(value: number): number { return value; },
    };
  }`, "fixture.ts");
  assert.match(result, /run: _makeSchedulable\(function\*/);
  assert.match(result, /plain\(value: number\): number \{ return value; \}/);
  assert.match(result, /export function factory/);
});

test("marked callbacks can contain checkpoints and scheduled calls", () => {
  const result = transformSource(`function helper() { return 1; }
    export function factory() {
      return {
        // @phryneas/schedule schedulable
        run() {
          // @phryneas/schedule may-yield-here
          return helper();
        }
      };
    }`, "fixture.ts");
  assert.match(result, /yield\* _commands.getSignal\(\)/);
  assert.match(result, /yield\* _commands.yieldNow\(\)/);
  assert.match(result, /yield\* _commands.execute\(helper\)\(\)/);
});

test("opt-in rejects unsupported functions", () => {
  for (const method of ["async run() {}", "*run() {}", "get run() { return 1; }"]) {
    assert.throws(() => transformSource(`const object = {
      // @phryneas/schedule schedulable
      ${method}
    };`, "fixture.ts"), /schedulable cannot opt/);
  }
});
