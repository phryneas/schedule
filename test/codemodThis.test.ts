import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { transformProject } from "../src/codemod/index.ts";

test("object methods retain their original code and contextual receiver type", async t => {
  const root = resolve(".");
  await mkdir(join(root, ".tmp"), { recursive: true });
  const directory = await mkdtemp(join(root, ".tmp/contextual-this-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source");
  const output = join(directory, "output");
  await mkdir(source);
  await mkdir(join(source, "__tests__"));
  const originalTest = "// This file must be copied verbatim.\n\nexport function test() { return 42; }\n";
  await writeFile(join(source, "__tests__/example.ts"), originalTest);
  const config = join(directory, "tsconfig.json");
  await writeFile(config, JSON.stringify({
    compilerOptions: { strict: true, target: "esnext", module: "nodenext" },
    include: ["source/*.mts"],
  }));
  await writeFile(join(source, "input.mts"), `
    function identity<T>(value: T): T { return value; }
    interface Self { self(): Self; }
    export function create(): Self {
      return { self() { return identity(this); } };
    }
    interface Sequence { [Symbol.iterator](): Sequence; }
    export function sequence(): Sequence {
      return { [Symbol.iterator]() { return identity(this); } };
    }
  `);
  await transformProject({
    tsconfig: config, sourceDirectory: source, outputDirectory: output,
    runtimeModule: join(root, "src/index.ts"),
    excludeFiles: ["**/__tests__/**"],
  });
  assert.equal(await readFile(join(output, "__tests__/example.ts"), "utf8"), originalTest);
  const generated = join(output, "input.mts");
  const code = await readFile(generated, "utf8");
  assert.ok(code.includes("self() { return identity(this); }"));
  assert.ok(code.includes("[Symbol.iterator]() { return identity(this); }"));
  assert.doesNotMatch(code, /makeSchedulable/);
  const result = spawnSync(join(root, "node_modules/.bin/tsc"), [
    "--ignoreConfig", "--noEmit", "--strict", "--target", "esnext",
    "--module", "nodenext", "--allowImportingTsExtensions", generated,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const module = await import(pathToFileURL(generated).href);
  const value = module.create();
  assert.equal(value.self(), value);
  const sequence = module.sequence();
  assert.equal(sequence[Symbol.iterator](), sequence);
});
