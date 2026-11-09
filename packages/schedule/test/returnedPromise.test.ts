import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { async, commands, ScheduleController } from "../src/index.ts";

test("returned promises and thenables survive scheduling waits without unhandled rejections or identity changes", () => {
  const runtime = new URL("../src/index.ts", import.meta.url).href;
  const result = spawnSync(process.execPath, [
    "--unhandled-rejections=strict", "--input-type=module", "--eval", `
    import assert from "node:assert/strict";
    import { runInNewContext } from "node:vm";
    import { async as scheduled, commands, makeSchedulable } from ${JSON.stringify(runtime)};

    let now = 0;
    Object.defineProperty(performance, "now", { value: () => now });
    for (const kind of ["callback", "immediate child", "yielding child"]) {
      for (const type of ["native", "foreign", "wrapped", "callable"]) {
        for (const pending of [false, true]) {
          const PromiseClass = type === "foreign" ? runInNewContext("Promise") : Promise;
          const reason = new Error("returned rejection");
          let original;
          function operation() {
            now += 20;
            const promise = pending
              ? new PromiseClass((resolve, reject) => queueMicrotask(() => reject(reason)))
              : PromiseClass.reject(reason);
            original = type === "wrapped" || type === "callable"
              ? Object.assign(type === "callable" ? function () {} : {}, {
                  then(onFulfilled, onRejected) {
                    assert.equal(this, original);
                    return promise.then(onFulfilled, onRejected);
                  },
                })
              : promise;
            return original;
          }
          const child = makeSchedulable(function* () {
            if (kind === "yielding child") yield* commands.getSignal;
            return operation();
          });
          function* work() {
            const value = yield* commands.execute(kind === "callback" ? operation : child)();
            assert.equal(value, original);
            return value.then(undefined, error => {
              assert.equal(error, reason);
              return 42;
            });
          }
          assert.equal(await scheduled(work()), 42);
        }
      }
    }
  `], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
});

test("a scheduling wait reads then once and preserves non-callable then values", async () => {
  let now = 0;
  const controller = new ScheduleController({ getNextTime: () => now });
  let reads = 0;
  const value = { get then() { reads++; return 42; } };
  function* work() {
    const result = yield* commands.execute(() => {
      now += 20;
      return value;
    })();
    assert.equal(result, value);
  }
  await async(work(), { signal: controller.signal });
  assert.equal(reads, 1);
});

for (const failure of ["getter", "subscription"] as const) {
  test(`then ${failure} errors reach the generator catch`, async () => {
    let now = 0;
    const controller = new ScheduleController({ getNextTime: () => now });
    const reason = new Error("subscription failed");
    const value = {
      get then() {
        if (failure === "getter") throw reason;
        return () => { throw reason; };
      },
    };
    function* work() {
      try {
        yield* commands.execute(() => {
          now += 20;
          return value;
        })();
      } catch (error) {
        assert.equal(error, reason);
        return "caught";
      }
      return "not caught";
    }
    assert.equal(await async(work(), { signal: controller.signal }), "caught");
  });
}
