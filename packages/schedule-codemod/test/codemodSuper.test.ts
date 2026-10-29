import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { transformSource } from "../src/index.ts";
import { async as scheduled, commands, makeSchedulable } from "../../schedule/src/index.ts";

test("super calls select the superclass method and preserve the current receiver", async t => {
  const root = resolve("../..");
  await mkdir(join(root, ".tmp"), { recursive: true });
  const directory = await mkdtemp(join(root, ".tmp/super-method-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = transformSource(`
    export class Base {
      value = 10;
      static value = 20;
      add(amount: number): number { return this.value + amount; }
      static add(amount: number): number { return this.value + amount; }
    }
    export class Derived extends Base {
      override value = 100;
      static override value = 200;
      override add(amount: number): number { return super.add(amount) + 1; }
      static override add(amount: number): number { return super.add(amount) + 2; }
    }
  `, "fixture.ts", { runtimeModule: join(root, "packages/schedule/src/index.ts") });
  assert.match(output, /_callee\d* = Base\.prototype\.add/);
  assert.match(output, /_callee\d* = Base\.add/);
  assert.match(output, /execute\(_callee\d*\)\.bind\(this\)/);
  assert.doesNotMatch(output, /_makeSchedulable</);
  assert.match(output, /declare add:/);
  assert.match(output, /declare static add:/);
  const file = join(directory, "generated.mts");
  await writeFile(file, output);
  const result = spawnSync(join(root, "node_modules/.bin/tsc"), [
    "--ignoreConfig", "--noEmit", "--strict", "--target", "esnext",
    "--module", "nodenext", "--allowImportingTsExtensions", file,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const module = await import(pathToFileURL(file).href);
  const instance = new module.Derived();
  assert.equal(instance.add(3), 104);
  assert.equal(await scheduled(instance.add.schedulable.bind(instance)(3)), 104);
  assert.equal(module.Derived.add(3), 205);
  assert.equal(await scheduled(module.Derived.add.schedulable.bind(module.Derived)(3)), 205);

  // A yielding base method must run in the caller's scheduler, not a nested sync run.
  let yielded = false;
  let baseSignal: unknown;
  const base = makeSchedulable(function* (this: { value: number }, amount: number) {
    baseSignal = yield* commands.getSignal;
    yield* commands.yieldNow;
    yielded = true;
    return this.value + amount;
  });
  module.Base.prototype.add = base;
  const run = makeSchedulable(function* () {
    const signal = yield* commands.getSignal;
    const result = yield* commands.execute(instance.add).bind(instance)(3);
    assert.equal(baseSignal, signal);
    return result;
  });
  assert.equal(await scheduled(run.schedulable()), 104);
  assert.equal(yielded, true);
});
