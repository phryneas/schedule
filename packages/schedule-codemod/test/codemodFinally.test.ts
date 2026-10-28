import assert from "node:assert/strict";
import test from "node:test";
import { transformSource } from "../src/index.ts";
import { async as scheduled, schedulableImplementationSymbol } from "../../schedule/src/index.ts";

const runtimeModule = new URL("../../schedule/src/index.ts", import.meta.url).href;

async function compile(source: string) {
  const output = transformSource(source, "fixture.js", { runtimeModule });
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("cancellation completes finally loops and synchronous cleanup calls", async () => {
  const module = await compile(`
    function cleanup(events, value) {
      // @phryneas/schedule may-yield-here
      events.push(value);
    }
    export function work(events, receiver) {
      try {
        // @phryneas/schedule may-yield-here
        events.push('resumed');
      } finally {
        for (let i = 0; i < 2; i++) {
          // @phryneas/schedule may-yield-here
          cleanup(events, i);
        }
        try {
          receiver?.release?.(events);
        } finally {
          cleanup.call(null, events, 'closed');
        }
      }
    }
  `);
  const controller = new AbortController();
  const reason = new Error("cancelled");
  const events: unknown[] = [];
  const pending = scheduled(module.work, {
    startImmediately: true,
    signal: {
      get aborted() { return controller.signal.aborted; },
      throwIfAborted() { controller.signal.throwIfAborted(); },
      addEventListener: controller.signal.addEventListener.bind(controller.signal),
      removeEventListener: controller.signal.removeEventListener.bind(controller.signal),
      shouldYield: true,
      bump() {},
    },
  })(events, {
    release(this: unknown, log: unknown[]) { log.push('released'); },
  });
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.deepEqual(events, [0, 1, 'released', 'closed']);
});

test("finally-only calls and checkpoints do not make a function schedulable", async () => {
  const module = await compile(`export function work(fn) {
    try { return 7; } finally {
      // @phryneas/schedule may-yield-here
      fn.call(null);
    }
  }`);
  assert.equal(module.work[schedulableImplementationSymbol], undefined);
  let calls = 0;
  assert.equal(module.work(() => { calls++; }), 7);
  assert.equal(calls, 1);
});

test("super cleanup calls preserve their receiver in transformed methods", async () => {
  const module = await compile(`
    class Base {
      release(events) { events.push(this.value); }
    }
    export class Derived extends Base {
      value = 'released';
      work(events) {
        try {
          // @phryneas/schedule may-yield-here
        } finally { super.release(events); }
      }
    }
  `);
  const instance = new module.Derived();
  const events: unknown[] = [];
  const iterator = instance.work[schedulableImplementationSymbol].call(instance, events);
  assert.equal(iterator.next().value.kind, 'getSignal');
  assert.equal(iterator.next({ shouldYield: true }).value.kind, 'yield');
  assert.equal(iterator.return().done, true);
  assert.deepEqual(events, ['released']);
});

test("optional super cleanup calls report unsupported syntax before opting out", () => {
  for (const cleanup of ["super.release?.();", "super['release']?.();"]) {
    assert.throws(() => transformSource(`
      class Base { release() {} }
      class Derived extends Base {
        work() {
          try {
            // @phryneas/schedule may-yield-here
          } finally { ${cleanup} }
        }
      }
    `, "fixture.js"), /Optional superclass method calls are not supported; replace this call with an explicit conditional before running the codemod\./);
  }
});

test("functions defined inside finally retain their own scheduling scope", async () => {
  const module = await compile(`export function create() {
    try {} finally {
      // @phryneas/schedule schedulable
      function work() {
        // @phryneas/schedule may-yield-here
        return 7;
      }
      return work;
    }
  }`);
  const work = module.create();
  const iterator = work[schedulableImplementationSymbol]();
  assert.equal(iterator.next().value.kind, 'getSignal');
  assert.equal(iterator.next({ shouldYield: true }).value.kind, 'yield');
  assert.deepEqual(iterator.next(null), { done: true, value: 7 });
});
