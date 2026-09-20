type StartupStage = {
  label: string
  run: () => Promise<void>
}

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

export const runStartupStages = async (stages: StartupStage[], parallel: boolean) => {
  if (!parallel) {
    for (const stage of stages) await runTimedStage(stage.label, stage.run)
    return
  }

  // Settle both branches before teardown: a pending branch could otherwise start
  // another service after cleanup has already stopped its dependencies.
  const results = await Promise.allSettled(
    stages.map((stage) => runTimedStage(stage.label, stage.run)),
  )
  const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []))
  if (errors.length > 0)
    throw new AggregateError(errors, `E2E startup failed: ${errors.map(String).join('; ')}`)
}
