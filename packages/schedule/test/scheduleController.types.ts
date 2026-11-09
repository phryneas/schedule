import { expectTypeOf } from "expect-type";
import { ScheduleController, type ScheduleSignal } from "../src/index.ts";

const controller = new ScheduleController({ signal: new AbortController().signal });
expectTypeOf(controller.signal).toEqualTypeOf<ScheduleSignal>();
expectTypeOf<ScheduleSignal>().toExtend<AbortSignal>();
expectTypeOf(controller.signal).toExtend<AbortSignal>();
// @ts-expect-error Scheduling hooks are protected on the controller.
controller.shouldYield;
// @ts-expect-error Scheduling hooks are protected on the controller.
controller.bump();
// @ts-expect-error Scheduling hooks are protected on the controller.
controller.schedule(() => {});

class CustomController extends ScheduleController {
  protected override get shouldYield() { return super.shouldYield; }
  protected override bump() { super.bump(); }
  protected override schedule(callback: () => void) { super.schedule(callback); }
}
expectTypeOf(new CustomController().signal).toEqualTypeOf<ScheduleSignal>();
