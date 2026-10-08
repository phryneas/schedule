import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { transformProject } from "../src/codemod/index.ts";
import { async as scheduled } from "../src/index.ts";

test("object methods retain their contextual receiver type", async t => {
  const root = resolve(".");
  await mkdir(join(root, ".tmp"), { recursive: true });
  const directory = await mkdtemp(join(root, ".tmp/contextual-this-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source");
  const output = join(directory, "output");
  await mkdir(source);
  const config = join(directory, "tsconfig.json");
  await writeFile(config, JSON.stringify({
    compilerOptions: { strict: true, target: "esnext", module: "nodenext" },
    include: ["source/*.mts"],
  }));
  await writeFile(join(source, "input.mts"), `
    interface Self { self(): Self; }
    export function create(): Self {
      return { self() { return this; } };
    }
    interface Sequence { [Symbol.iterator](): Sequence; }
    export function sequence(): Sequence {
      return { [Symbol.iterator]() { return this; } };
    }
  `);
  await transformProject({
    tsconfig: config, sourceDirectory: source, outputDirectory: output,
    runtimeModule: join(root, "src/index.ts"),
  });
  const generated = join(output, "input.mts");
  const code = await readFile(generated, "utf8");
  assert.match(code, /function\*\s*\(this: Self\)/);
  assert.match(code, /function\*\s*\(this: Sequence\)/);
  const result = spawnSync(join(root, "node_modules/.bin/tsc"), [
    "--ignoreConfig", "--noEmit", "--strict", "--target", "esnext",
    "--module", "nodenext", "--allowImportingTsExtensions", generated,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const module = await import(pathToFileURL(generated).href);
  const value = module.create();
  assert.equal(value.self(), value);
  assert.equal(await scheduled(value.self).bind(value)(), value);
  const sequence = module.sequence();
  assert.equal(sequence[Symbol.iterator](), sequence);
  assert.equal(await scheduled(sequence[Symbol.iterator]).bind(sequence)(), sequence);
});
