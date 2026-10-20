import assert from "node:assert/strict";
import test from "node:test";
import { transformSync } from "@babel/core";
import plugin from "../src/transform.ts";
import { transformSource } from "../src/index.ts";
import { async as scheduled } from "../../schedule/src/index.ts";

test("file explicit mode preserves calls and does not wrap functions or methods", () => {
  const source = `// @phryneas/schedule explicit
export function work(fn) { return fn(helper()); }
function helper() { return other(); }
export class Worker { run(fn) { return fn?.(helper()); } }
`;
  const output = transformSource(source, "fixture.ts");
  assert.doesNotMatch(output, /makeSchedulable|yield\*|\.execute\(/);
  assert.match(output, /fn\(helper\(\)\)/);
  assert.match(output, /fn\?\.\(helper\(\)\)/);
});

test("block explicit mode covers nested scopes without affecting siblings", () => {
  const output = transformSource(`export function work(fn) {
  {
    // @phryneas/schedule explicit
    fn(helper());
    class Local { run() { return fn(); } }
    if (fn) { fn?.(); }
  }
  return fn();
}
function helper() { return 1; }`, "fixture.ts");
  assert.match(output, /fn\(helper\(\)\)/);
  assert.match(output, /run\(\) \{ return fn\(\); \}/);
  assert.match(output, /fn\?\.\(\)/);
  assert.match(output, /yield\* _commands.execute\(fn\)\(\)/);
});

test("explicit functions keep manual checkpoints and execute their calls synchronously", async () => {
  const output = transformSync(`export function work(fn) {
    // @phryneas/schedule explicit
    // @phryneas/schedule may-yield-here
    return fn(3);
  }
  export function automatic(fn) { return fn(); }`, {
    configFile: false, babelrc: false,
    plugins: [[plugin, { runtimeModule: new URL("../../schedule/src/index.ts", import.meta.url).href }]],
  })!.code!;
  const { work } = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
  const events: string[] = [];
  let expired = true;
  const signal = {
    aborted: false, throwIfAborted() {},
    get shouldYield() { return expired; },
    bump() { expired = false; events.push("yield"); },
  };
  const result = await scheduled(work, signal)((value: number) => { events.push("call"); return value + 1; });
  assert.equal(result, 4);
  assert.deepEqual(events, ["yield", "call"]);
  assert.match(output, /return fn\(3\)/);
  assert.match(output, /yield\* _commands.execute\(fn\)\(\)/);
});

test("file explicit mode keeps checkpoints and direct calls to scheduled helpers", () => {
  const output = transformSource(`// @phryneas/schedule explicit
export function child() {
  // @phryneas/schedule may-yield-here
  return external();
}
export function parent() { return child(); }`, "fixture.ts");
  assert.match(output, /yield\* _commands.yieldNow/);
  assert.match(output, /export function parent\(\) \{ return child\(\); \}/);
  assert.doesNotMatch(output, /\.execute\(|\.command/);
});

test("file-scope explicit directives apply to the whole file", () => {
  const output = transformSource(`export function before(fn) { return fn(); }
// @phryneas/schedule explicit
export function after(fn) { return fn(); }`, "fixture.ts");
  assert.doesNotMatch(output, /makeSchedulable/);
});

test("explicit rejects misplaced comments", () => {
  for (const source of [
    `function work() { first();
      // @phryneas/schedule explicit
      second();
    }`,
    `const object = {
      // @phryneas/schedule explicit
      value: callback()
    };`,
  ]) assert.throws(() => transformSource(source, "fixture.ts"), /explicit must be/);
});
