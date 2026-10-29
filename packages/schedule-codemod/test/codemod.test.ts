import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { transformSync } from "@babel/core";
import plugin from "../src/transform.ts";
import { async as scheduled, commands, makeSchedulable } from "../../schedule/src/index.ts";
import * as graphql from "graphql";

const runtimeModule = new URL("../../schedule/src/index.ts", import.meta.url).href;

function transform(source: string, filename = "fixture.mjs") {
  return transformSync(source, {
    filename, configFile: false, babelrc: false,
    plugins: [[plugin, { runtimeModule }]],
  })!.code!;
}

async function load(source: string) {
  return import(`data:text/javascript;base64,${Buffer.from(transform(source)).toString("base64")}`);
}

test("dynamic ordinary calls keep a deadline boundary and evaluate calls conditionally", async () => {
  const module = await load(`
    export function run(object, argument, enabled) {
      return enabled && object.method(argument());
    }
  `);
  const events: string[] = [];
  const object = {
    value: 7,
    get method() {
      events.push("get");
      return function (this: { value: number }, n: number) {
        events.push("call");
        return this.value + n;
      };
    },
  };
  const argument = () => { events.push("argument"); return 3; };
  let expired = true;
  const signal = {
    aborted: false, throwIfAborted() {},
    addEventListener() {}, removeEventListener() {},
    get shouldYield() { return expired; },
    bump() { expired = false; events.push("yielded"); },
  };
  assert.equal(await scheduled(commands.execute(module.run, true)(object, argument, false), { signal }), false);
  assert.deepEqual(events, []);
  const pending = scheduled(commands.execute(module.run, true)(object, argument, true), { signal });
  assert.deepEqual(events, []);
  assert.equal(await pending, 10);
  assert.deepEqual(events, ["yielded", "get", "argument", "call"]);
});

test("dynamic calls accept ordinary functions with unrelated schedulable properties", async () => {
  const module = await load(`export function run(callback) { return callback(3); }`);
  const callback = Object.assign((n: number) => n + 1, {
    schedulable() { assert.fail("not a schedulable implementation"); },
  });
  assert.equal(module.run(callback), 4);
  assert.equal(await scheduled(module.run.schedulable(callback)), 4);
});

test("plugin preserves function hoisting and schedules local calls", async () => {
  const output = transform(`
    export const initial = twice(3);
    export function twice(value) { return add(value, value); }
    function add(a, b) { return a + b; }
  `);
  assert.match(output, /yield\* .*\.execute\(add/);
  const module = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
  assert.equal(module.initial, 6);
  assert.equal(module.twice(4), 8);
  assert.equal(await scheduled(module.twice.schedulable(4)), 8);
});

test("plugin preserves method receivers and evaluates receiver expressions once", async () => {
  const module = await load(`
    export class Counter {
      constructor() { this.value = 2; }
      get current() { return this.value; }
      add(n) { this.value += n; return this.value; }
      run(n) { return this.add(n); }
    }
    export function run(counter) {
      let calls = 0;
      function receiver() { calls++; return counter; }
      return [receiver().run(3), calls];
    }
  `);
  assert.deepEqual(module.run(new module.Counter()), [5, 1]);
  assert.deepEqual(await scheduled(module.run.schedulable(new module.Counter())), [5, 1]);
  assert.equal(new module.Counter().current, 2);
  assert.equal(Object.hasOwn(new module.Counter(), "run"), false);
});

test("hoisting fallback preserves early captures and indirect initialization calls", async () => {
  const module = await load(`
    export const captured = work;
    export const initial = start();
    function start() { return work(3); }
    function identity(value) { return value; }
    export function work(value) { return identity(value); }
  `);
  assert.equal(module.captured, module.work);
  assert.equal(module.initial, 3);
  assert.equal(await scheduled(module.captured.schedulable(4)), 4);
});

test("class installations precede existing static initialization", async () => {
  const module = await load(`
    function helper() { return 7; }
    export class Worker {
      static initial = new Worker().run();
      static { this.other = this.work(); }
      run() { return helper(); }
      static work() { return helper(); }
    }
  `);
  assert.equal(module.Worker.initial, 7);
  assert.equal(module.Worker.other, 7);
});

test("class definition side effects retain module function hoisting", async () => {
  for (const declaration of [
    "export class Worker { static value = work(); }",
    "export class Worker { static { this.value = work(); } }",
    "export class Worker { [work()]() {} }",
    "export class Worker extends base() {}",
  ]) {
    const module = await load(`
      ${declaration}
      function helper() { return 7; }
      export function work() { return helper(); }
      function base() { work(); return class {}; }
    `);
    assert.equal(module.work(), 7);
    if ("value" in module.Worker) assert.equal(module.Worker.value, 7);
  }
});

test("receiver temporaries avoid existing names and nested-scope references", async () => {
  const module = await load(`
    const _receiver = 11;
    export function run(getObject) {
      const _receiver2 = 22;
      function nested() { return _receiver + _receiver2; }
      return [getObject().read(), nested(), _receiver, _receiver2];
    }
  `);
  const getObject = () => ({ value: 7, read() { return this.value; } });
  assert.deepEqual(module.run(getObject), [7, 33, 11, 22]);
  assert.deepEqual(await scheduled(module.run.schedulable(getObject)), [7, 33, 11, 22]);
});

test("stable receivers bind directly while getter-mutated bindings keep their receiver", async () => {
  const stable = transform(`
    export function run(schema) { return schema.read(); }
    export function own() { return this.read(); }
  `);
  assert.doesNotMatch(stable, /_receiver/);
  assert.match(stable, /_callee\d* = schema.read/);
  assert.match(stable, /execute\(_callee\d*\)\.bind\(schema\)/);
  assert.match(stable, /_callee\d* = this.read/);
  assert.match(stable, /execute\(_callee\d*\)\.bind\(this\)/);
  const module = await load(`
    export function run() {
      let receiver = {
        value: 7,
        get read() {
          receiver = { value: 99 };
          return function () { return this.value; };
        }
      };
      return receiver.read();
    }
  `);
  assert.equal(module.run(), 7);
  assert.equal(await scheduled(module.run.schedulable()), 7);
});

test("optional methods preserve receivers, getter evaluation, and conditional arguments", async () => {
  const module = await load(`
    export function run(getReceiver, key, argument) {
      return getReceiver()[key()]?.(argument());
    }
    export function optionalReceiver(getReceiver, key, argument) {
      return getReceiver()?.[key()]?.(argument());
    }
    export function returnedCallback(queue, argument) {
      return queue.shift()?.(argument());
    }
  `);
  for (const run of [module.run, (...args: unknown[]) => scheduled(module.run.schedulable(...args)), module.optionalReceiver, (...args: unknown[]) => scheduled(module.optionalReceiver.schedulable(...args))]) {
    for (const present of [false, true]) {
      const events: string[] = [];
      const receiver = {
        value: 10,
        get method() {
          events.push("get");
          return present ? makeSchedulable(function* (this: typeof receiver, value: number) {
            assert.equal(this, receiver);
            yield* commands.yieldNow;
            events.push("call");
            return this.value + value;
          }) : undefined;
        },
      };
      const result = await run(
        () => { events.push("receiver"); return receiver; },
        () => { events.push("key"); return "method"; },
        () => { events.push("argument"); return 3; },
      );
      assert.equal(result, present ? 13 : undefined);
      assert.deepEqual(events, present ? ["receiver", "key", "get", "argument", "call"] : ["receiver", "key", "get"]);
    }
  }
  const unexpected = () => { throw new Error("must not evaluate"); };
  assert.equal(module.optionalReceiver(() => null, unexpected, unexpected), undefined);
  assert.equal(await scheduled(module.optionalReceiver.schedulable(() => undefined, unexpected, unexpected)), undefined);
  for (const run of [module.returnedCallback, (...args: unknown[]) => scheduled(module.returnedCallback.schedulable(...args))]) {
    const queue = [makeSchedulable(function* (this: unknown, value: number) {
      assert.equal(this, undefined);
      yield* commands.yieldNow;
      return value;
    })];
    assert.equal(await run(queue, () => 7), 7);
    assert.equal(queue.length, 0);
    assert.equal(await run(queue, unexpected), undefined);
  }
});

test("receiver assignments stay conditional and preserve nested argument evaluation order", async () => {
  const source = `
    export function run(enabled, choose, mark) {
      return enabled && (choose("outer").add(choose("inner").add(mark("arg", 3))) + mark("last", 5));
    }
    export function conditional(enabled, choose, mark) {
      return enabled ? choose("yes").add(mark("arg", 3)) : mark("no", 0);
    }
  `;
  const original = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const transformed = await load(source);
  async function observe(fn, enabled) {
    const events: string[] = [];
    const choose = (name: string) => {
      events.push(`choose ${name}`);
      return { name, add(value: number) { events.push(`add ${this.name}`); return value + 1; } };
    };
    const mark = (name: string, value: number) => { events.push(name); return value; };
    return { value: await fn(enabled, choose, mark), events };
  }
  for (const name of ["run", "conditional"]) {
    for (const enabled of [false, true]) {
      const expected = await observe(original[name], enabled);
      assert.deepEqual(await observe(transformed[name], enabled), expected);
      assert.deepEqual(await observe((...args: unknown[]) => scheduled(transformed[name].schedulable(...args)), enabled), expected);
    }
  }
});

test("receiver temporaries are isolated across recursive and concurrent executions", async () => {
  const module = await load(`
    export function recurse(receiver, depth) {
      return receiver(depth).add(depth ? recurse(receiver, depth - 1) : 0);
    }
  `);
  const add = makeSchedulable(function* (this: { value: number }, amount: number) {
    yield* commands.yieldNow;
    return this.value + amount;
  });
  const receiver = (value: number) => ({ value, add });
  assert.equal(module.recurse(receiver, 4), 10);
  assert.deepEqual(await Promise.all([
    scheduled(module.recurse.schedulable(receiver, 4)),
    scheduled(module.recurse.schedulable(receiver, 7)),
  ]), [10, 28]);
});

test("plugin leaves existing generator and async functions unchanged", async () => {
  const module = await load(`
    export function* values() { yield 1; return 2; }
    export async function value() { return 3; }
  `);
  assert.deepEqual(module.values().next(), { value: 1, done: false });
  assert.equal(await module.value(), 3);
});

test("GraphQL.js 16.14.2 transforms and runs through its public API", async (t) => {
  assert.equal(graphql.version, "16.14.2");
  const root = dirname(fileURLToPath(import.meta.resolve("graphql/package.json")));
  const output = await mkdtemp(join(tmpdir(), "scheduled-graphql-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  async function compile(relative = "") {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await compile(path);
      else if (path.endsWith(".mjs")) {
        const code = transform(await readFile(join(root, path), "utf8"), path);
        await mkdir(dirname(join(output, path)), { recursive: true });
        await writeFile(join(output, path), code);
      }
    }
  }
  await compile();
  const transformed = await import(pathToFileURL(join(output, "index.mjs")).href);
  const query = "query Test($id: ID!) { user(id: $id) { id name } }";
  const original = graphql.parse(query, { noLocation: true });
  assert.deepEqual(transformed.parse(query, { noLocation: true }), original);
  assert.deepEqual(await scheduled(transformed.parse.schedulable(query, { noLocation: true })), original);
  assert.equal(transformed.print(original), graphql.print(original));
  const names: string[] = [];
  await scheduled(transformed.visit.schedulable(original, { Name(node: any) { names.push(node.value); } }));
  assert.ok(names.includes("user"));
  const schema = transformed.buildSchema("type Query { hello: String }");
  assert.deepEqual(transformed.validate(schema, transformed.parse("{ hello }")), []);
  assert.deepEqual(await scheduled(transformed.validate.schedulable(schema, transformed.parse("{ hello }"))), []);
  assert.deepEqual(await transformed.graphql({ schema, source: "{ hello }", rootValue: { hello: "world" } }), {
    data: Object.assign(Object.create(null), { hello: "world" }),
  });
  await assert.rejects(scheduled(transformed.parse.schedulable("{ invalid")), /Syntax Error/);

  // A supplied schedulable visitor must be executed through the same runner.
  let visited = false;
  const visitor = makeSchedulable(function* () {
    yield* commands.yieldNow;
    visited = true;
  });
  await scheduled(transformed.visit.schedulable(original, { Document: visitor }));
  assert.equal(visited, true);
});
