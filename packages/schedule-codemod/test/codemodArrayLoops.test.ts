import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { transformProject, transformSource } from "../src/index.ts";
import { async as scheduled, commands, makeSchedulable } from "../../schedule/src/index.ts";

test("opt-in map and some loops preserve results, short circuiting, and lexical this", async t => {
  const root = resolve("../..");
  const directory = await mkdtemp(join(root, ".tmp/array-loops-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source");
  const output = join(directory, "output");
  await mkdir(source);
  const config = join(directory, "tsconfig.json");
  await writeFile(config, JSON.stringify({ compilerOptions: {
    strict: true, target: "esnext", module: "nodenext", allowImportingTsExtensions: true, noEmit: true,
  }, include: ["source/*.ts"] }));
  await writeFile(join(source, "fixture.ts"), `
export function map(items: number[], callback: (value: number) => number) {
  // @phryneas/schedule transform-to-loop
  return items.map(item => callback(item));
}
export function some(items: number[], callback: (value: number) => boolean) {
  // @phryneas/schedule transform-to-loop
  return items.some(function(item) {
    // @phryneas/schedule may-yield-here
    return callback(item);
  });
}
export function declarations(getItems: () => number[]) {
  // @phryneas/schedule transform-to-loop
  const mapped = getItems().map(function(item) { return item * 2; });
  // @phryneas/schedule transform-to-loop
  const found = mapped.some(item => item > 2);
  return { mapped, found };
}
export function lexical(this: { factor: number }, items: number[]) {
  // @phryneas/schedule transform-to-loop
  return items.map(items => items * this.factor);
}
`);
  await transformProject({ tsconfig: config, sourceDirectory: source, outputDirectory: output,
    runtimeModule: join(root, "packages/schedule/src/index.ts") });
  const text = await readFile(join(output, "fixture.ts"), "utf8");
  assert.match(text, /for \(const item of /);
  assert.doesNotMatch(text, /transform-to-loop|\.map\(|\.some\(/);
  const someBody = text.slice(text.indexOf("export var some"), text.indexOf("export var declarations"));
  assert.ok(someBody.indexOf("_commands.yieldNow") >= 0, text);
  assert.ok(someBody.indexOf("_commands.yieldNow") < someBody.indexOf("_commands.execute(callback)"), someBody);
  const checked = spawnSync(join(root, "node_modules/.bin/tsc"), [
    "--ignoreConfig", "--strict", "--noEmit", "--target", "esnext", "--module", "nodenext",
    "--allowImportingTsExtensions", join(output, "fixture.ts"),
  ], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  const module = await import(pathToFileURL(join(output, "fixture.ts")).href);
  const double = makeSchedulable(function* (value: number) {
    yield* commands.yieldNow;
    return value * 2;
  });
  assert.deepEqual(module.map([1, 2, 3], double), [2, 4, 6]);
  assert.deepEqual(await scheduled(module.map)([1, 2, 3], double), [2, 4, 6]);
  let calls = 0;
  const predicate = makeSchedulable(function* (value: number) {
    calls++;
    yield* commands.yieldNow;
    return value === 2;
  });
  assert.equal(await scheduled(module.some)([1, 2, 3], predicate), true);
  assert.equal(calls, 2);
  assert.equal(module.some([], () => true), false);
  let receivers = 0;
  assert.deepEqual(module.declarations(() => { receivers++; return [1, 2]; }), { mapped: [2, 4], found: true });
  assert.equal(receivers, 1);
  assert.deepEqual(module.lexical.call({ factor: 3 }, [1, 2]), [3, 6]);
});

test("unsupported array loop callbacks fail instead of changing their semantics", () => {
  for (const callback of [
    "(item, index) => index", "(item, index, array) => array", "...callbacks",
    "callback", "function(item) { return this.value; }",
    "function(item) { return arguments[0]; }", "function(item) { return new.target; }",
    "function self(item) { return self(item); }",
    "async item => item", "function*(item) { return item; }",
    "(...items) => items", "({ value }) => value", "(item = 1) => item",
    "item => { log(item); return item; }", "item => item++",
    "item => eval('item')",
  ]) {
    assert.throws(() => transformSource(`function run(items: any) {
      // @phryneas/schedule transform-to-loop
      return items.map(${callback});
    }`, "fixture.ts"), /transform-to-loop:/, callback);
  }
  for (const expression of ["items.map(item => item, receiver)", "items?.map(item => item)", "items.filter(item => item)"]) {
    assert.throws(() => transformSource(`function run(items: any) {
      // @phryneas/schedule transform-to-loop
      return ${expression};
    }`, "fixture.ts"), /transform-to-loop:/);
  }
});

test("array loop transforms are opt-in and reject misplaced markers", () => {
  assert.doesNotMatch(transformSource("function run(items: number[]) { return items.map(item => item * 2); }", "fixture.ts"), /for \(/);
  assert.throws(() => transformSource(`function run(items: number[]) {
    // @phryneas/schedule transform-to-loop
    return 1 + items.map(item => item).length;
  }`, "fixture.ts"), /transform-to-loop:/);
});
