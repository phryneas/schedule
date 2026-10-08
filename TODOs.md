# TODOs

- [ ] Review support for promise-returning functions in `scheduler.execute`.
  Currently it does not await ordinary promise-returning callees; `syncAware`
  is the available workaround when an awaited async implementation is needed.

- [ ] Forward `thisArg` to schedulable implementations in `scheduler.execute`.
  Currently it is honored only for ordinary callees. Passing needed state as
  arguments is a workaround.

- [ ] Define runtime compatibility and any needed fallbacks. Currently the
  runtime requires `performance.now()` and `MessageChannel`, plus
  `AbortSignal.throwIfAborted()` when using cancellation.
