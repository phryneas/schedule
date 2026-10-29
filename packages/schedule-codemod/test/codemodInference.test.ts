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

test("native constructors stay direct without excluding shadowed callbacks", async t => {
  const root = resolve("../..");
  await mkdir(join(root, ".tmp"), { recursive: true });
  const directory = await mkdtemp(join(root, ".tmp/native-boolean-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source");
  const output = join(directory, "output");
  await mkdir(source);
  const config = join(directory, "tsconfig.json");
  await writeFile(config, JSON.stringify({ compilerOptions: {
    strict: true, target: "esnext", module: "nodenext", allowImportingTsExtensions: true, noEmit: true,
  }, include: ["source/*.ts"] }));
  await writeFile(join(source, "native.ts"), `
export function devAssert(condition: unknown, message: string): void {
  const booleanCondition = Boolean(condition);
  if (!booleanCondition) throw new Error(message);
}
export function caller(value: unknown): void { devAssert(value, "required"); }
export function qualified(value: unknown): boolean { return globalThis.Boolean(value); }
export function indirect(value: unknown): boolean { return Boolean.call(undefined, value); }
export function constructors(value: string) {
  return [String(value), Number(value), BigInt(value), Symbol(value), Object(value),
    Array(value), Date(), RegExp(value), Error(value), TypeError(value), Function(value),
    AggregateError([]), EvalError(value), RangeError(value), ReferenceError(value),
    SyntaxError(value), URIError(value), SuppressedError(null, null),
    Intl.Collator(), Intl.DateTimeFormat(), Intl.NumberFormat(),
    globalThis.String(value), String.call(undefined, value), Number.apply(undefined, [value])];
}
`);
  await writeFile(join(source, "callback.ts"), `
export function run(Boolean: (value: unknown) => boolean, value: unknown): boolean {
  return Boolean(value);
}
export function shadowed(String: (value: unknown) => string, value: unknown): string {
  return String(value);
}
`);
  await transformProject({
    tsconfig: config, sourceDirectory: source, outputDirectory: output,
    runtimeModule: join(root, "packages/schedule/src/index.ts"),
  });
  const native = await readFile(join(output, "native.ts"), "utf8");
  assert.doesNotMatch(native, /makeSchedulable|yield|commands/);
  assert.match(native, /Boolean\(condition\)/);
  const callback = await readFile(join(output, "callback.ts"), "utf8");
  assert.match(callback, /yield\* _commands.execute\(Boolean\)/);
  assert.match(callback, /yield\* _commands.execute\(String\)/);
  const { run } = await import(pathToFileURL(join(output, "callback.ts")).href);
  const fn = makeSchedulable(function* (value: unknown) {
    yield* commands.yieldNow;
    return Boolean(value);
  });
  assert.equal(run(fn, 1), true);
  assert.equal(await scheduled(run.schedulable(fn, 0)), false);
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
  const signal = {
    shouldYield: false, aborted: false, throwIfAborted() {}, bump() {},
    addEventListener() {}, removeEventListener() {},
  };
  const callback = makeSchedulable(function* (this: { value: number }) {
    assert.equal(yield* commands.getSignal, signal);
    yield* commands.yieldNow;
    return this.value;
  });
  let finished = false;
  const pending = scheduled(run.schedulable(callback, { value: 42 }), { signal }).then((value: unknown) => { finished = true; return value; });
  await Promise.resolve();
  assert.equal(finished, false);
  assert.equal(await pending, 42);
  function plain(this: { value: number }) { return this.value; }
  assert.equal(run(plain, { value: 7 }), 7);
  assert.equal(await scheduled(run.schedulable(plain, { value: 8 })), 8);
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
  assert.match(text, /yield\* recurse.schedulable\(n - 1\)/);
  assert.match(text, /yield\* mutualB.schedulable\(n - 1\)/);
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
export function factory<T>(fn: (value: T) => T) {
  return /* @phryneas/schedule schedulable */ function(value: T) { return fn(value); };
}
export function annotatedFactory(): (value: number) => number {
  return /* @phryneas/schedule schedulable */ function(value: number) { return value; };
}
export function mixedFactory(flag: boolean) {
  if (flag) return /* @phryneas/schedule schedulable */ function(value: number) { return value; };
  return function(value: number) { return value; };
}
`);
  await writeFile(join(source, "caller.ts"), `
import { plain, scheduled as renamed, Worker, OtherWorker, PlainWorker, arrow, chain2, factory, annotatedFactory, mixedFactory } from './callee.ts';
const produced = factory((value: number) => value + 1);
const hidden = annotatedFactory();
const mixed = mixedFactory(true);
export function runFactory(value: number): number { return produced(value); }
export function runHidden(value: number): number { return hidden(value); }
export function runMixed(value: number): number { return mixed(value); }
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
  assert.match(text, /yield\* renamed.schedulable\(1\)/);
  assert.match(text, /yield\* produced.schedulable\(value\)/);
  assert.doesNotMatch(text, /_commands.execute\(produced\)/);
  assert.match(text, /_commands.execute\(hidden\)/);
  assert.match(text, /_commands.execute\(mixed\)/);
  assert.match(text, /plain\(2\)/);
  assert.doesNotMatch(text, /_commands.execute\(plain\)|plain.schedulable/);
  assert.match(text, /_commands.execute\(callback\)\(3\)/);
  assert.match(text, /worker.run.schedulable.bind\(worker\)\(4\)/);
  assert.match(text, /arrow.schedulable\(5\)/);
  assert.match(text, /chain2\(6\)/);
  assert.match(text, /worker.plain\(7\)/);
  const callee = await readFile(join(output, "callee.ts"), "utf8");
  assert.match(callee, /export function chain2\(value: number\): number \{ return chain\(value\); \}/);
  assert.match(text, /unionScheduled[^]*?worker.run.schedulable.bind\(worker\)\(1\)/);
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
  const module = await import(pathToFileURL(join(output, "caller.ts")).href);
  assert.equal(module.runFactory(3), 4);
  assert.equal(await scheduled(module.runFactory.schedulable(3)), 4);
});
