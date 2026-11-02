import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { async, execute, getSignal, ScheduleController, sync, syncAware, yieldNow } from "../src/index.ts";

test("ScheduleController exposes a stable native AbortSignal and forwards parent cancellation", () => {
  const parent = new AbortController();
  const controller = new ScheduleController({ signal: parent.signal });
  const signal = controller.signal;
  assert.ok(controller instanceof AbortController);
  assert.ok(signal instanceof AbortSignal);
  assert.equal(controller.signal, signal);
  const request = new Request("https://example.com", { signal });
  const reason = new Error("parent cancelled");
  let target: EventTarget | null = null;
  signal.onabort = event => { target = event.target; };
  parent.abort(reason);
  assert.equal(target, signal);
  assert.equal(signal.reason, reason);
  assert.equal(request.signal.reason, reason);
  assert.throws(() => signal.throwIfAborted(), error => error === reason);
  assert.throws(() => signal.shouldYield, error => error === reason);
  assert.equal(getEventListeners(parent.signal, "abort").length, 0);
});

test("already aborted parents and child cancellation preserve the first reason", () => {
  const parent = new AbortController();
  const reason = new Error("parent");
  parent.abort(reason);
  const child = new ScheduleController({ signal: parent.signal });
  assert.equal(child.signal.reason, reason);
  child.abort(new Error("later"));
  assert.equal(child.signal.reason, reason);
  assert.equal(getEventListeners(parent.signal, "abort").length, 0);

  const liveParent = new AbortController();
  const independent = new ScheduleController({ signal: liveParent.signal });
  independent.abort(reason);
  assert.equal(independent.signal.reason, reason);
  assert.equal(liveParent.signal.aborted, false);
  assert.equal(getEventListeners(liveParent.signal, "abort").length, 0);
});

test("dispose detaches the parent without aborting the child", () => {
  const parent = new AbortController();
  const child = new ScheduleController({ signal: parent.signal });
  assert.equal(getEventListeners(parent.signal, "abort").length, 1);
  child.dispose();
  child.dispose();
  assert.equal(getEventListeners(parent.signal, "abort").length, 0);
  parent.abort();
  assert.equal(child.signal.aborted, false);
  child.abort("child");
  assert.equal(child.signal.reason, "child");
});

test("scheduler forwards initial entry and every scheduling boundary to subclass hooks", async () => {
  class CustomController extends ScheduleController {
    expired = false;
    bumps = 0;
    callbacks: Array<() => void> = [];
    protected override get shouldYield() { return this.expired; }
    protected override bump() { this.expired = false; this.bumps++; }
    protected override schedule(callback: () => void) { this.callbacks.push(callback); }
  }
  const controller = new CustomController();
  const events: string[] = [];
  function* work() {
    assert.equal(yield* getSignal, controller.signal);
    events.push("entered");
    yield* yieldNow;
    controller.expired = true;
    yield* execute(() => events.push("execute"))();
    controller.expired = true;
    yield* syncAware({ sync() {}, async: async () => { events.push("syncAware"); } })();
    return 42;
  }
  const pending = async(work(), { signal: controller.signal });
  assert.deepEqual(events, []);
  for (let i = 0; i < 4; i++) {
    assert.equal(controller.callbacks.length, 1);
    controller.callbacks.shift()!();
    await Promise.resolve();
  }
  assert.equal(await pending, 42);
  assert.deepEqual(events, ["entered", "execute", "syncAware"]);
  assert.equal(controller.bumps, 4);
  controller.expired = true;
  assert.equal(controller.signal.shouldYield, true);
  const { bump } = controller.signal;
  bump();
  assert.equal(controller.signal.shouldYield, false);
});

test("internal controllers detach after success and failure", async () => {
  for (const fail of [false, true]) {
    const parent = new AbortController();
    function* work() {
      yield* getSignal;
      if (fail) throw new Error("failed");
      return 42;
    }
    const pending = async(work(), { signal: parent.signal });
    assert.equal(getEventListeners(parent.signal, "abort").length, 1);
    if (fail) await assert.rejects(pending, /failed/);
    else assert.equal(await pending, 42);
    assert.equal(getEventListeners(parent.signal, "abort").length, 0);
  }
});

test("caller-owned controllers stay connected after the scheduler finishes", async () => {
  const parent = new AbortController();
  const controller = new ScheduleController({ signal: parent.signal });
  assert.equal(await async(getSignal, { signal: controller.signal }), controller.signal);
  parent.abort("after completion");
  assert.equal(controller.signal.reason, "after completion");
});

test("synchronous execution uses a plain signal and never requests a yield", () => {
  const signal = sync(getSignal);
  assert.equal(Object.getPrototypeOf(signal), Object.prototype);
  assert.equal(signal.shouldYield, false);
  signal.bump();
  assert.equal(signal.shouldYield, false);
  let called = false;
  signal.schedule(() => { called = true; });
  assert.equal(called, false);
});
