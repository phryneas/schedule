import assert from "node:assert/strict";
import test from "node:test";
import { async, sync, commands, makeSchedulable, ScheduleController } from "../src/index.ts";

for (const scheduler of [sync, async]) {
  for (const schedulable of [false, true]) {
    test(`${scheduler.name} forwards ${schedulable ? "schedulable" : "ordinary"} command errors into catch and finally`, async () => {
      const error = new Error("command failed");
      const fail = schedulable
        ? makeSchedulable(function* () { throw error; })
        : () => { throw error; };
      const events: string[] = [];
      const run = makeSchedulable(function* () {
        try {
          yield* commands.execute(fail)();
        } catch (caught) {
          assert.equal(caught, error);
          events.push("catch");
          return 42;
        } finally {
          yield* commands.yieldNow;
          events.push("finally");
        }
      });
      assert.equal(await scheduler(run.schedulable()), 42);
      assert.deepEqual(events, ["catch", "finally"]);
    });
  }

  test(`${scheduler.name} forwards syncAware errors, including thrown undefined`, async () => {
    const run = makeSchedulable(function* () {
      try {
        yield* commands.syncAware({
          sync() { throw undefined; },
          async async() { throw undefined; },
        })();
      } catch (caught) {
        assert.equal(caught, undefined);
        return "caught";
      }
      return "not caught";
    });
    assert.equal(await scheduler(run.schedulable()), "caught");
  });
}

for (const hook of ["shouldYield", "schedule", "bump"] as const) {
  for (const timing of ["before", "after"] as const) {
    test(`${hook} errors ${timing} a command reach the generator catch`, async () => {
      const reason = new Error("scheduling failed");
      let armed = false;
      let called = false;
      function fail() {
        armed = false;
        throw reason;
      }
      const controller = new (class extends ScheduleController {
        protected override get shouldYield() {
          if (armed && hook === "shouldYield") fail();
          return armed;
        }
        protected override schedule(callback: () => void) {
          if (armed && hook === "schedule") fail();
          queueMicrotask(callback);
        }
        protected override bump() {
          if (armed && hook === "bump") fail();
          armed = false;
        }
      })();
      function* work() {
        armed = timing === "before";
        try {
          yield* commands.execute(() => {
            called = true;
            armed = timing === "after";
          })();
        } catch (error) {
          assert.equal(error, reason);
          return "caught";
        }
        return "not caught";
      }
      assert.equal(await async(work(), { signal: controller.signal, startImmediately: true }), "caught");
      assert.equal(called, timing === "after");
    });
  }
}
