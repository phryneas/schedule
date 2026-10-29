import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { makeSchedulable, isSchedulableFunction } from "../src/index.ts";
import { getSchedulableImplementation } from "../src/internal.ts";

test("the scheduler symbol retains the generator implementation", () => {
  const implementation = function* () { return 42; };
  const fn = makeSchedulable(implementation);
  assert.equal(getSchedulableImplementation(fn), implementation);
  assert.equal(isSchedulableFunction(fn), true);
  assert.equal(isSchedulableFunction(Object.assign(() => 42, { schedulable: implementation })), false);
  assert.equal(fn(), 42);
  assert.deepEqual(Object.keys(fn), []);
});

test("declaration consumers retain generic inference without exposing the internal symbol", async t => {
  const root = resolve(".");
  await mkdir(join(root, ".tmp"), { recursive: true });
  const output = await mkdtemp(join(root, ".tmp/marker-declarations-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  function compile(args: string[]) {
    const result = spawnSync(resolve(root, "../../node_modules/.bin/tsc"), args, { encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  compile(["-p", "tsconfig.test-types.json", "--noEmit", "false", "--emitDeclarationOnly", "--outDir", output]);
  const declaration = await readFile(join(output, "test/genericDeclaration.types.d.ts"), "utf8");
  assert.match(declaration, /schedulable:/);
  assert.doesNotMatch(declaration, /schedulableImplementationSymbol/);
  const consumer = join(output, "consumer.mts");
  await writeFile(consumer, `
    import { expectTypeOf } from "expect-type";
    import { scheduled } from "./test/genericDeclaration.types.js";
    import { async, commands } from "./src/index.js";
    import type { SchedulableIterable } from "./src/index.js";
    expectTypeOf([1, 2, 3].map(scheduled)).toEqualTypeOf<number[]>();
    expectTypeOf(async(scheduled.schedulable(1))).toEqualTypeOf<Promise<number>>();
    expectTypeOf(commands.execute(scheduled)(1)).toEqualTypeOf<SchedulableIterable<number>>();
    expectTypeOf(scheduled.schedulable(1)).toEqualTypeOf<SchedulableIterable<number>>();
  `);
  compile(["--ignoreConfig", "--noEmit", "--strict", "--target", "esnext", "--module", "nodenext", "--allowImportingTsExtensions", consumer]);
});
