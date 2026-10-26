// One controller for the whole invocation: SIGINT aborts it and every in-flight
// request built by `call` carries its signal. It lives here rather than in main.ts
// so a command can import it without pulling the entry module into a cycle.
const runController = new AbortController()
let cancelled = false

export function cancel(): void {
  cancelled = true
  runController.abort()
}

/** For the waits that poll rather than carry a signal, such as the device flow. */
export function isCancelled(): boolean {
  return cancelled
}

export function runSignal(): AbortSignal {
  return runController.signal
}
