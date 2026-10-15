import assert from "node:assert/strict";
import test from "node:test";
import { async, sync, commands, makeSchedulable } from "../src/index.ts";

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
          yield* commands.yieldNow();
          events.push("finally");
        }
      });
      assert.equal(await scheduler(run)(), 42);
      assert.deepEqual(events, ["catch", "finally"]);
    });
  }

  test(`${scheduler.name} forwards syncAware errors, including thrown undefined`, async () => {
    const run = makeSchedulable(function* () {
      try {
        yield* commands.syncAware({
          sync() { throw undefined; },
          async async() { throw undefined; },
          args: [],
        });
      } catch (caught) {
        assert.equal(caught, undefined);
        return "caught";
      }
      return "not caught";
    });
    assert.equal(await scheduler(run)(), "caught");
  });
}
