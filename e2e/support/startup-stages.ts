export const runTimedStage = async (label: string, run: () => Promise<void>) => {
  const started = performance.now()
  console.warn(`[e2e] ${label}: starting`)
  let outcome = 'failed'
  try {
    await run()
    outcome = 'ready'
  } finally {
    console.warn(
      `[e2e] ${label}: ${outcome} in ${((performance.now() - started) / 1_000).toFixed(1)}s`,
    )
  }
}
