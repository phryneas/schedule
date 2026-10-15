import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { transformSource } from "../src/index.ts";
import { async, commands, makeSchedulable } from "../../schedule/src/index.ts";

test("standalone generator overloads preserve published call signatures", async t => {
  const root = resolve("../..");
  await mkdir(join(root, ".tmp"), { recursive: true });
  const directory = await mkdtemp(join(root, ".tmp/overloads-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = join(root, "packages/schedule/src/index.ts");
  const output = transformSource(`
    function plain<T>(value: T): T { return value; }
    export function simple(value: number): number { return plain(value); }
    export function identity<T>(value: T): T { return plain(value); }
    export function nullable(value: null | undefined): void;
    export function nullable(value: string): string;
    export function nullable(value: string | null | undefined): string | undefined;
    export function nullable(value: string | null | undefined): string | undefined {
      if (value) return plain(value);
    }
    export function pick(x: number): number;
    export function pick(x: string): string;
    export function pick(x: number | string): number | string { return plain(x); }

    export class Picker<A extends object, B, C = string> {
      static value = 7;
      static read(): number { return plain(this.value); }
      identity<T>(value: T): T { return plain(value); }
      any<T>(value: T): T { return plain(value); }
      less(a: B, b: B): boolean { return plain(a < b); }
      classValue(value: C): C { return plain(value); }
      store(value: C): C;
      store(value: C, fallback: C): C;
      store(value: C, fallback?: C): C { return plain(value); }
      fluent(): this { return plain(this); }
      pick(x: number): number;
      pick(x: string): string;
      pick(x: number | string): number | string { return plain(x); }
    }
  `, "input.ts", { runtimeModule: runtime });
  assert.match(output, /function\* _pickImpl/);
  assert.match(output, /simple = _makeSchedulable\(\s*function\*/);
  assert.match(output, /pick = _makeSchedulable</);
  assert.match(output, /identity = _makeSchedulable</);
  assert.match(output, /<A extends object, B, C = string>\(\) =>/);
  assert.doesNotMatch(output, /type [ABC] =/);
  assert.doesNotMatch(output, /function\*<A/);
  assert.doesNotMatch(output, /\bas\s+(?:unknown|any)\b/);
  assert.match(output, /declare classValue: _SchedulableMethod</);
  assert.match(output, /namespace Signatures/);
  assert.match(output, /interface identity<[^]*?extends _identitySync/);
  const source = join(directory, "generated.mts");
  await writeFile(source, output);

  function compile(args: string[]) {
    const result = spawnSync(join(root, "node_modules/.bin/tsc"), [
      "--ignoreConfig", "--strict", "--target", "esnext", "--module", "nodenext",
      "--allowImportingTsExtensions", "--skipLibCheck", ...args,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  const declarations = join(directory, "declarations");
  compile(["--declaration", "--emitDeclarationOnly", "--rootDir", root, "--outDir", declarations, source]);
  const declaration = join(declarations, relative(root, directory), "generated.d.mts");
  assert.match(await readFile(declaration, "utf8"), /schedulableImplementationSignal/);
  const consumer = join(directory, "consumer.mts");
  await writeFile(consumer, `
    import { expectTypeOf } from "expect-type";
    import { simple, identity, nullable, pick, Picker } from ${JSON.stringify(declaration.replace(/\.d\.mts$/, ".mjs"))};
    import { async, commands, makeSchedulable } from ${JSON.stringify(runtime)};
    import type { SchedulableIterable } from ${JSON.stringify(runtime)};
    expectTypeOf(simple(1)).toEqualTypeOf<number>();
    expectTypeOf(async(simple)(1)).toEqualTypeOf<Promise<number>>();
    expectTypeOf(commands.execute(simple)(1)).toEqualTypeOf<SchedulableIterable<number>>();
    expectTypeOf([1, 2, 3].map(identity)).toEqualTypeOf<number[]>();
    expectTypeOf(async(identity)(42)).toEqualTypeOf<Promise<number>>();
    expectTypeOf(nullable(null)).toEqualTypeOf<void>();
    expectTypeOf(nullable("text")).toEqualTypeOf<string>();
    expectTypeOf(async(nullable)(undefined)).toEqualTypeOf<Promise<void>>();
    expectTypeOf(async(nullable)("text")).toEqualTypeOf<Promise<string>>();
    expectTypeOf(commands.execute(nullable)(null)).toEqualTypeOf<SchedulableIterable<void>>();
    expectTypeOf(commands.execute(nullable)("text")).toEqualTypeOf<SchedulableIterable<string>>();
    declare const maybe: string | undefined;
    expectTypeOf(nullable(maybe)).toEqualTypeOf<string | undefined>();
    expectTypeOf(pick(1)).toEqualTypeOf<number>();
    expectTypeOf(pick("a")).toEqualTypeOf<string>();
    expectTypeOf(async(pick)(1)).toEqualTypeOf<Promise<number>>();
    expectTypeOf(async(pick)("a")).toEqualTypeOf<Promise<string>>();
    expectTypeOf(commands.execute(pick)(1)).toEqualTypeOf<SchedulableIterable<number>>();
    expectTypeOf(commands.execute(pick)("a")).toEqualTypeOf<SchedulableIterable<string>>();
    const receiver = new Picker();
    const specialized = new Picker<object, boolean, number>();
    expectTypeOf(specialized.classValue(1)).toEqualTypeOf<number>();
    expectTypeOf(async(specialized.classValue)(1)).toEqualTypeOf<Promise<number>>();
    class Derived extends Picker<object, boolean, number> { extra = 1; }
    const derived = new Derived();
    expectTypeOf(derived.fluent()).toEqualTypeOf<Derived>();
    expectTypeOf(async(derived.fluent)()).toEqualTypeOf<Promise<Derived>>();
    expectTypeOf(commands.execute(derived.fluent)()).toEqualTypeOf<SchedulableIterable<Derived>>();
    expectTypeOf([1, 2, 3].map(receiver.identity)).toEqualTypeOf<number[]>();
    expectTypeOf([1, 2, 3].map(receiver.any)).toEqualTypeOf<number[]>();
    expectTypeOf([1, 2, 3].map(commands.execute(receiver.identity))).toEqualTypeOf<SchedulableIterable<number>[]>();
    declare const mutablePicker: Picker<object, boolean, Map<string, number>>;
    const readonlyPicker: Picker<object, boolean, ReadonlyMap<string, number>> = mutablePicker;
    expectTypeOf(specialized.store(1)).toEqualTypeOf<number>();
    expectTypeOf(async(specialized.store)(1, 2)).toEqualTypeOf<Promise<number>>();
    expectTypeOf(commands.execute(specialized.store)(1, 2)).toEqualTypeOf<SchedulableIterable<number>>();
    expectTypeOf(commands.execute(receiver.pick).bind(receiver)(1)).toEqualTypeOf<SchedulableIterable<number>>();
    expectTypeOf(commands.execute(receiver.pick).bind(receiver)("a")).toEqualTypeOf<SchedulableIterable<string>>();
    // @ts-expect-error Invalid arguments must still be rejected.
    commands.execute(pick)(true);
  `);
  compile(["--noEmit", consumer]);

  const module = await import(pathToFileURL(source).href);
  const instance = new module.Picker();
  assert.equal(instance.fluent(), instance);
  assert.equal(await async(instance.fluent).call(instance), instance);
  assert.equal(instance.less(1, 2), true);
  assert.equal(module.Picker.read(), 7);
  assert.equal(await async(module.Picker.read).call(module.Picker), 7);
  assert.equal(module.nullable(null), undefined);
  assert.equal(await async(module.nullable)(undefined), undefined);
  assert.equal(await async(module.nullable)("text"), "text");
  assert.equal(module.pick(42), 42);
  assert.equal(await async(module.pick)("text"), "text");
  const work = makeSchedulable(function* () {
    return yield* commands.execute(module.pick)(42);
  });
  assert.equal(work(), 42);
  assert.equal(await async(work)(), 42);
});
