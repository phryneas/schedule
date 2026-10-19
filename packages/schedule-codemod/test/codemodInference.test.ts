import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { transformProject } from "../src/index.ts";
import { async as scheduled, commands, makeSchedulable } from "../../schedule/src/index.ts";

test("dynamic dispatch keeps callable signatures in both branches", () => {
  const result = spawnSync(resolve("../../node_modules/.bin/tsc"), [
    "--ignoreConfig", "--noEmit", "--strict", "--target", "esnext", "--module", "nodenext",
    "--allowImportingTsExtensions", resolve("test/dynamicDispatch.types.ts"),
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a guarded callback stays schedulable while the synchronous branch stays direct", async t => {
  const root = resolve("../..");
  await mkdir(join(root, ".tmp"), { recursive: true });
  const directory = await mkdtemp(join(root, ".tmp/guarded-callback-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source");
  const output = join(directory, "output");
  await mkdir(source);
  const config = join(directory, "tsconfig.json");
  const runtime = join(root, "packages/schedule/src/index.ts");
  await writeFile(config, JSON.stringify({ compilerOptions: {
    strict: true, target: "esnext", module: "nodenext", allowImportingTsExtensions: true, noEmit: true,
  }, include: ["source/*.ts"] }));
  await writeFile(join(source, "input.ts"), `
import { isSchedulableFunction } from ${JSON.stringify(join(root, "packages/schedule/src/isSchedulableFunction.ts"))};
export function run(fn: (this: { value: number }) => number, receiver: { value: number }): number {
  // @phryneas/schedule may-yield-here
  if (isSchedulableFunction<number, []>(fn)) return fn.call(receiver);
  // @phryneas/schedule synchronous
  return fn.call(receiver);
}
`);
  await transformProject({ tsconfig: config, sourceDirectory: source, outputDirectory: output, runtimeModule: runtime });
  const generated = join(output, "input.ts");
  const text = await readFile(generated, "utf8");
  assert.match(text, /yield\* _commands.execute\(fn\).bind\(receiver\)\(\)/);
  assert.match(text, /return fn.call\(receiver\)/);
  const compilation = spawnSync(join(root, "node_modules/.bin/tsc"), [
    "--ignoreConfig", "--noEmit", "--strict", "--target", "esnext", "--module", "nodenext", "--allowImportingTsExtensions", generated,
  ], { encoding: "utf8" });
  assert.equal(compilation.status, 0, compilation.stdout + compilation.stderr);
  const { run } = await import(pathToFileURL(generated).href);
  const signal = { shouldYield: false, aborted: false, throwIfAborted() {}, bump() {} };
  const callback = makeSchedulable(function* (this: { value: number }) {
    assert.equal(yield* commands.getSignal(), signal);
    yield* commands.yieldNow();
    return this.value;
  });
  let finished = false;
  const pending = scheduled(run, signal)(callback, { value: 42 }).then((value: unknown) => { finished = true; return value; });
  await Promise.resolve();
  assert.equal(finished, false);
  assert.equal(await pending, 42);
  function plain(this: { value: number }) { return this.value; }
  assert.equal(run(plain, { value: 7 }), 7);
  assert.equal(await scheduled(run)(plain, { value: 8 }), 8);
});

test("inferred return types survive direct and mutual recursion", async t => {
  const root = resolve("../..");
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
    runtimeModule: join(root, "packages/schedule/src/index.ts") });
  const generated = join(output, "input.ts");
  const text = await readFile(generated, "utf8");
  assert.match(text, /_SchedulableIterable<void>/);
  assert.match(text, /yield\* recurse.command\(n - 1\)/);
  assert.match(text, /yield\* mutualB.command\(n - 1\)/);
  const result = spawnSync(join(root, "node_modules/.bin/tsc"), [
    "--ignoreConfig", "--strict", "--noEmit", "--target", "esnext", "--module", "nodenext",
    "--allowImportingTsExtensions", generated,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("cached commands follow transformed declarations across files, with dynamic fallbacks", async t => {
  const root = resolve("../..");
  const directory = await mkdtemp(join(root, ".tmp/commands-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source");
  const output = join(directory, "output");
  await mkdir(source);
  const config = join(directory, "tsconfig.json");
  await writeFile(config, JSON.stringify({ compilerOptions: {
    strict: true, target: "esnext", module: "nodenext", allowImportingTsExtensions: true, noEmit: true,
  }, include: ["source/*.ts"] }));
  await writeFile(join(source, "callee.ts"), `
export function plain(value: number): number { return value; }
export function scheduled(value: number): number;
export function scheduled(value: string): string;
export function scheduled(value: number | string): number | string {
  // @phryneas/schedule may-yield-here
  return value;
}
export class Worker {
  kind = 'worker' as const;
  run(value: number): number { return scheduled(value); }
  plain(value: number): number { return plain(value); }
}
export class OtherWorker {
  kind = 'other' as const;
  run(value: number): number { return scheduled(value); }
  plain(value: number): number { return value; }
}
export class PlainWorker {
  kind = 'plain' as const;
  run(value: number): number { return value; }
}
export const arrow = (value: number): number => scheduled(value);
export function chain(value: number): number { return plain(value); }
export function chain2(value: number): number { return chain(value); }
`);
  await writeFile(join(source, "caller.ts"), `
import { plain, scheduled as renamed, Worker, OtherWorker, PlainWorker, arrow, chain2 } from './callee.ts';
export function run(callback: (value: number) => number, worker: Worker): number {
  return renamed(1) + plain(2) + callback(3) + worker.run(4) + arrow(5) + chain2(6) + worker.plain(7);
}
export function builtin(processRef: { getBuiltinModule: (id: string) => unknown }): unknown {
  return processRef.getBuiltinModule('node:diagnostics_channel');
}
export function unionScheduled(worker: Worker | OtherWorker): number { return worker.run(1); }
export function unionPlain(worker: Worker | OtherWorker): number { return worker.plain(1); }
export function unionMixed(worker: Worker | PlainWorker): number { return worker.run(1); }
export function unionUnknown(worker: Worker | { run(value: number): number }): number { return worker.run(1); }
`);
  await transformProject({ tsconfig: config, sourceDirectory: source, outputDirectory: output,
    exclude: [{ file: "caller.ts", name: "getBuiltinModule" }],
    runtimeModule: join(root, "packages/schedule/src/index.ts") });
  const text = await readFile(join(output, "caller.ts"), "utf8");
  assert.match(text, /yield\* renamed.command\(1\)/);
  assert.match(text, /plain\(2\)/);
  assert.doesNotMatch(text, /_commands.execute\(plain\)|plain.command/);
  assert.match(text, /_commands.execute\(callback\)\(3\)/);
  assert.match(text, /worker.run.command.bind\(worker\)\(4\)/);
  assert.match(text, /arrow.command\(5\)/);
  assert.match(text, /chain2\(6\)/);
  assert.match(text, /worker.plain\(7\)/);
  const callee = await readFile(join(output, "callee.ts"), "utf8");
  assert.match(callee, /export function chain2\(value: number\): number \{ return chain\(value\); \}/);
  assert.match(text, /unionScheduled[^]*?worker.run.command.bind\(worker\)\(1\)/);
  assert.match(text, /export function unionPlain[^]*?return worker.plain\(1\);/);
  assert.match(text, /unionMixed[^]*?_callee\d* = worker.run[^]*?_commands.execute\(_callee\d*\).bind\(worker\)\(1\)/);
  assert.match(text, /unionUnknown[^]*?_callee\d* = worker.run[^]*?_commands.execute\(_callee\d*\).bind\(worker\)\(1\)/);
  assert.match(text, /export function builtin/);
  assert.match(text, /return processRef.getBuiltinModule\('node:diagnostics_channel'\)/);
  const result = spawnSync(join(root, "node_modules/.bin/tsc"), [
    "--ignoreConfig", "--strict", "--noEmit", "--target", "esnext", "--module", "nodenext",
    "--allowImportingTsExtensions", join(output, "caller.ts"),
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
