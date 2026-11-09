import assert from "node:assert/strict";
import test from "node:test";
import { async, commands, makeSchedulable, ScheduleController } from "../src/index.ts";
import type { SchedulableIterable } from "../src/index.ts";

test("short scheduled children share the parent's deadline", async (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const child = makeSchedulable(function* (): SchedulableIterable<void> {
    now += 10;
  });
  const parent = makeSchedulable(function* (): SchedulableIterable<void> {
    const signal = yield* commands.getSignal;
    yield* child.schedulable();
    assert.equal(signal.shouldYield, false);
    yield* child.schedulable();
    // The exhausted budget yields before resuming the parent.
    assert.equal(signal.shouldYield, false);
    yield* commands.execute(() => assert.equal(signal.shouldYield, false))();
  });
  await async(parent.schedulable());
});

for (const command of ["syncAware", "execute", "child"] as const) {
  for (const rejects of [false, true]) {
    for (const expired of [false, true]) {
      test(`${command} ${rejects ? "rejection" : "fulfillment"} resumes with expired=${expired}`, async () => {
        let now = 0;
        const events: string[] = [];
        class Controller extends ScheduleController {
          protected override schedule(callback: () => void) {
            events.push("schedule");
            queueMicrotask(callback);
          }
        }
        const controller = new Controller({ getNextTime: () => now });
        const reason = new Error("operation failed");
        const work = makeSchedulable(function* (): SchedulableIterable<void> {
          try {
            const operation = () => {
              now = expired ? 20 : 10;
              if (rejects) throw reason;
              return 42;
            };
            const value = yield* (command === "syncAware"
              ? commands.syncAware({ sync: operation, async: async () => operation() })()
              : commands.execute(command === "execute" ? operation : makeSchedulable(function* () {
                  yield* commands.getSignal;
                  return operation();
                }))());
            events.push("fulfilled");
            assert.equal(value, 42);
          } catch (error) {
            events.push("rejected");
            assert.equal(error, reason);
          }
          assert.equal(controller.signal.shouldYield, false);
        });
        await async(work.schedulable(), { signal: controller.signal, startImmediately: true });
        assert.deepEqual(events, [
          ...(expired ? ["schedule"] : []),
          rejects ? "rejected" : "fulfilled",
        ]);
        // Only an actual scheduled yield resets the deadline.
        now = expired ? 35 : 16;
        assert.equal(controller.signal.shouldYield, !expired);
      });
    }
  }
}

test("returning from a child checks time spent since its last actual yield", async (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const child = makeSchedulable(function* (): SchedulableIterable<void> {
    now = 20;
    yield* commands.yieldNow;
    now = 40;
  });
  const parent = makeSchedulable(function* (): SchedulableIterable<void> {
    const signal = yield* commands.getSignal;
    yield* child.schedulable();
    assert.equal(signal.shouldYield, false);
  });
  await async(parent.schedulable());
});
