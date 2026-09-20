export async function runStartupTasks(tasks: (() => Promise<void>)[], parallel: boolean) {
  if (!parallel) {
    for (const task of tasks) await task()
    return
  }

  // Settle every owner before teardown; a rejected sibling must not start a
  // process after cleanup has already finished.
  const results = await Promise.allSettled(tasks.map((task) => task()))
  const failures = results.filter((result) => result.status === 'rejected')
  if (failures.length > 0)
    throw new AggregateError(
      failures.map((result) => result.reason),
      `E2E startup failed: ${failures.map(({ reason }) => (reason instanceof Error ? reason.message : String(reason))).join('; ')}`,
    )
}
