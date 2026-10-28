import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
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

for (const signalKind of ["AbortSignal", "ScheduleSignal"] as const) {
  function wrapSignal(signal: AbortSignal): AbortSignal | ScheduleSignal {
    if (signalKind === "AbortSignal") return signal;
    return {
      get aborted() {
        return signal.aborted;
      },
      throwIfAborted: signal.throwIfAborted.bind(signal),
      addEventListener: signal.addEventListener.bind(signal),
      removeEventListener: signal.removeEventListener.bind(signal),
      shouldYield: false,
      bump() {},
    };
  }

  test(`${signalKind}: syncAware removes abort listeners on settlement and observes late rejections`, async () => {
    for (const outcome of [
      "resolve",
      "reject",
      "abort",
      "abort in callback",
    ] as const) {
      const controller = new AbortController();
      const reason = new Error(outcome);
      const operation = Promise.withResolvers<number>();
      const work = makeSchedulable(function* () {
        return yield* syncAware({
          sync: () => 42,
          async: () => {
            if (outcome === "abort in callback") controller.abort(reason);
            return operation.promise;
          },
          startImmediately: true,
        })();
      });
      const pending = async(work, {
        signal: wrapSignal(controller.signal),
        startImmediately: true,
      })();
      if (outcome !== "abort in callback") {
        assert.equal(getEventListeners(controller.signal, "abort").length, 1);
      }
      if (outcome === "resolve") {
        operation.resolve(42);
        assert.equal(await pending, 42);
      } else {
        const rejected = assert.rejects(pending, (error) => error === reason);
        if (outcome === "reject") operation.reject(reason);
        else controller.abort(reason);
        await rejected;
        // The external operation can still fail after the scheduler has cancelled.
        operation.reject(new Error("late external failure"));
      }
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    }
  });

  test(
    `${signalKind}: cancellation interrupts a pending syncAware operation and closes all frames`,
    { timeout: 1000 },
    async () => {
      const controller = new AbortController();
      const reason = new Error("cancelled while awaiting");
      const events: string[] = [];
      const child = makeSchedulable(function* () {
        try {
          yield* syncAware({
            sync() {},
            async: () => new Promise<void>(() => {}),
            startImmediately: true,
          })();
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
        } finally {
          events.push("parent closed");
        }
      });

      const pending = async(parent, {
        signal: wrapSignal(controller.signal),
        startImmediately: true,
      })();
      controller.abort(reason);

      await assert.rejects(pending, (error) => error === reason);
      assert.deepEqual(events, ["child closed", "parent closed"]);
    },
  );
}

test("cancellation while advancing an iterator is terminal", async () => {
  for (const resumeWithError of [false, true]) {
    for (const returnImmediately of [false, true]) {
      const controller = new AbortController();
      const reason = new Error("cancelled during advancement");
      const events: string[] = [];
      const work = makeSchedulable(function* () {
        yield* getSignal;
        try {
          if (resumeWithError) {
            try {
              yield* execute(() => {
                throw new Error("callback failed");
              })();
            } catch {
              controller.abort(reason);
            }
          } else {
            controller.abort(reason);
          }
          if (!returnImmediately) {
            yield* execute(() => events.push("callback after cancellation"), true)();
          }
          return 42;
        } finally {
          events.push("closed");
        }
      });

      await assert.rejects(
        async(work, { signal: controller.signal, startImmediately: true })(),
        (error) => error === reason,
      );
      assert.deepEqual(events, ["closed"]);
    }
  }
});

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
      addEventListener: controller.signal.addEventListener.bind(controller.signal),
      removeEventListener: controller.signal.removeEventListener.bind(controller.signal),
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
