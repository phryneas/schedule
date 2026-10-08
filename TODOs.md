# TODOs

- [ ] Propagate cancellation to nested `asyncScheduler` calls, including calls
  started by a `syncAware` async implementation. Currently these runs do not
  inherit the outer cancellation signal, so aborting the outer run can leave
  nested work running. Explicit signal forwarding is a workaround; ordinary
  nested calls through `scheduler.execute` already share the scheduling signal.
  Verify that aborting an outer run stops nested cooperative work, while
  unrelated concurrent runs remain unaffected. Account for shared memoized
  work so cancelling one consumer does not cancel work needed by another.

- [ ] Clarify handling of unadapted functions in `asyncScheduler`. Currently
  it logs a warning and calls them in a promise microtask without splitting
  their work into chunks. Cooperative execution requires an adapted implementation.

- [ ] Review support for promise-returning functions in `scheduler.execute`.
  Currently it does not await ordinary promise-returning callees; `syncAware`
  is the available workaround when an awaited async implementation is needed.

- [ ] Forward `thisArg` to schedulable implementations in `scheduler.execute`.
  Currently it is honored only for ordinary callees. Passing needed state as
  arguments is a workaround.

- [ ] Define runtime compatibility and any needed fallbacks. Currently the
  runtime requires `performance.now()` and `MessageChannel`, plus
  `AbortSignal.throwIfAborted()` when using cancellation.
