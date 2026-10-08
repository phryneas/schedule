# TODOs

- [ ] Define runtime compatibility and any needed fallbacks. Currently the
  runtime requires `performance.now()` and `MessageChannel`, plus
  `AbortSignal.throwIfAborted()` when using cancellation.
