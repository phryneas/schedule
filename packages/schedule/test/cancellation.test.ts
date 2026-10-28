import assert from "node:assert/strict";
import test from "node:test";
import {
  makeSchedulable,
  async,
  getSignal,
  yieldNow,
  execute,
  syncAware,
} from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";
import type { ScheduleSignal } from "../src/types.ts";

test("AbortController cancels scheduled work", async () => {
  const work = makeSchedulable(function* (): SchedulableIterable<number> {
    const signal = yield* getSignal;
    yield* yieldNow;
    signal.throwIfAborted();
    return 42;
  });
  const controller = new AbortController();
  const pending = async(work, {
    signal: controller.signal,
    startImmediately: true,
  })();
  controller.abort();

  await assert.rejects(pending, { name: "AbortError" });
});

test("execute propagates cancellation without affecting concurrent runs", async () => {
  const work = makeSchedulable(function* (): SchedulableIterable<number> {
    const signal = yield* getSignal;
    yield* yieldNow;
    signal.throwIfAborted();
    return 42;
  });
  const parent = makeSchedulable(function* (): SchedulableIterable<number> {
    return yield* execute(work)();
  });
  const controller = new AbortController();
  const pending = async(parent, {
    signal: controller.signal,
    startImmediately: true,
  })();
  const independent = async(parent)();
  controller.abort();

  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(await independent, 42);
});

test("ordinary execute callback errors reject the scheduled run", async () => {
  const reason = new Error("callback failed");
  const parent = makeSchedulable(function* (): SchedulableIterable<void> {
    yield* execute(() => {
      throw reason;
    })();
  });

  await assert.rejects(async(parent)(), (error) => error === reason);
});

test("cancellation during a scheduling wait closes active frames with a custom signal", async () => {
  for (const command of ["yield", "execute", "syncAware"] as const) {
    const controller = new AbortController();
    const reason = new Error(`cancelled during ${command}`);
    const events: string[] = [];
    const signal: ScheduleSignal = {
      get aborted() {
        return controller.signal.aborted;
      },
      throwIfAborted() {
        controller.signal.throwIfAborted();
      },
      shouldYield: true,
      bump() {
        events.push("bump");
      },
    };
    const child = makeSchedulable(function* () {
      try {
        events.push("entered");
        if (command === "yield") {
          yield* yieldNow;
        } else if (command === "execute") {
          yield* execute(() => events.push("callback"))();
        } else {
          yield* syncAware({
            sync() {
              events.push("sync callback");
            },
            async: async () => {
              events.push("async callback");
            },
          })();
        }
        events.push("resumed");
      } catch {
        events.push("caught");
      } finally {
        events.push("child closed");
      }
    });
    const parent = makeSchedulable(function* () {
      try {
        yield* execute(child, true)();
        events.push("parent resumed");
      } finally {
        events.push("parent closed");
      }
    });

    const pending = async(parent, { signal, startImmediately: true })();
    assert.deepEqual(events, ["entered"]);
    controller.abort(reason);

    await assert.rejects(pending, (error) => error === reason);
    assert.deepEqual(
      events,
      ["entered", "child closed", "parent closed"],
      command,
    );
  }
});
