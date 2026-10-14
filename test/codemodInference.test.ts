import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { transformProject } from "../src/codemod/index.ts";

test("inferred return types survive direct and mutual recursion", async t => {
  const root = resolve(".");
  await mkdir(join(root, ".tmp"), { recursive: true });
  const directory = await mkdtemp(join(root, ".tmp/inference-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source");
  const output = join(directory, "output");
  await mkdir(source);
  const config = join(directory, "tsconfig.json");
  await writeFile(config, JSON.stringify({ compilerOptions: {
    strict: true, target: "esnext", module: "nodenext", allowImportingTsExtensions: true, noEmit: true,
  }, include: ["source/*.ts"] }));
  await writeFile(join(source, "input.ts"), `
export function recurse(n: number) {
  if (n > 0) recurse(n - 1);
}
export function mutualA(n: number) {
  if (n > 0) mutualB(n - 1);
}
export function mutualB(n: number) {
  if (n > 0) mutualA(n - 1);
}
`);
  await transformProject({ tsconfig: config, sourceDirectory: source, outputDirectory: output,
    runtimeModule: join(root, "src/index.ts") });
  const generated = join(output, "input.ts");
  const text = await readFile(generated, "utf8");
  assert.match(text, /_SchedulableIterable<void>/);
  const result = spawnSync(join(root, "node_modules/.bin/tsc"), [
    "--ignoreConfig", "--strict", "--noEmit", "--target", "esnext", "--module", "nodenext",
    "--allowImportingTsExtensions", generated,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
