import type { ScheduleSignal } from "./types.ts";

function defaultGetNextTime(): number {
  return performance.now();
}

export class ScheduleController extends AbortController {
  private readonly scheduleSignal: AbortSignal & ScheduleSignal;
  private nextYield: number;
  private detachParent: (() => void) | undefined;
  private getNextTime: () => number;

  constructor({
    signal,
    getNextTime = defaultGetNextTime,
  }: { signal?: AbortSignal; getNextTime?: () => number } = {}) {
    super();
    const controller = this;
    const nativeSignal = super.signal;
    this.getNextTime = getNextTime;
    this.nextYield = this.getNextTime() + 16;
    this.scheduleSignal = Object.defineProperties(nativeSignal, {
      shouldYield: { configurable: true, get: () => controller.shouldYield },
      bump: { configurable: true, value: () => controller.bump() },
      schedule: {
        configurable: true,
        value: (callback: () => void) => controller.schedule(callback),
      },
    }) as AbortSignal & ScheduleSignal;
    if (signal?.aborted) {
      super.abort(signal.reason);
    } else if (signal) {
      const abort = () => {
        this.dispose();
        super.abort(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      this.detachParent = () => signal.removeEventListener("abort", abort);
    }
  }

  override abort(reason?: unknown): void {
    this.dispose();
    super.abort(reason);
  }

  /** Stop forwarding parent cancellation without aborting this controller. */
  dispose(): void {
    this.detachParent?.();
    this.detachParent = undefined;
  }

  override get signal(): AbortSignal & ScheduleSignal {
    return this.scheduleSignal;
  }

  protected get shouldYield(): boolean {
    this.signal.throwIfAborted();
    return this.getNextTime() >= this.nextYield;
  }

  protected bump(): void {
    this.nextYield = this.getNextTime() + 16;
  }

  protected schedule(callback: () => void): void {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      port2.close();
      callback();
    };
    port2.postMessage(null);
  }
}
