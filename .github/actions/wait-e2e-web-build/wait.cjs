const { setTimeout: delay } = require('node:timers/promises')

module.exports = async function waitForBuild({
  github,
  context,
  core,
  runAttempt,
  now = Date.now,
  sleep = delay,
  timeoutMs = 30 * 60 * 1000,
}) {
  const started = now()
  const run = { ...context.repo, run_id: context.runId, per_page: 100 }
  core.info('Waiting for core-e2e-web-build in this workflow run')

  while (now() - started < timeoutMs) {
    const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRunAttempt, {
      ...run,
      attempt_number: runAttempt,
    })
    const producer = jobs.find(
      (job) =>
        job.name === 'Prepare Core E2E Web Build' ||
        job.name.endsWith(' / Prepare Core E2E Web Build'),
    )
    if (producer?.status === 'completed' && producer.conclusion !== 'success') {
      throw new Error(
        `Web build finished with ${producer.conclusion} before publishing an artifact`,
      )
    }

    if (producer && ['in_progress', 'completed'].includes(producer.status)) {
      const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, run)
      const upload = producer.steps?.find((step) => step.name === 'Upload Web build')
      const artifact = artifacts.find((item) => {
        if (item.expired || !/^core-e2e-web-build-[1-9]\d*$/.test(item.name)) return false
        if (producer.status === 'in_progress') {
          // A rebuilding producer must publish this attempt's immutable artifact.
          return item.name === `core-e2e-web-build-${runAttempt}`
        }
        // GitHub relabels reused successful jobs with the current run_attempt.
        // Their upload step keeps its original timestamps, identifying the artifact
        // to reuse when only consumers are rerun (including across several attempts).
        return (
          upload?.conclusion === 'success' &&
          item.created_at >= upload.started_at &&
          item.created_at <= upload.completed_at
        )
      })
      if (artifact) {
        const seconds = Math.round((now() - started) / 1000)
        core.info(`Web build artifact ${artifact.name} ready after ${seconds}s`)
        await core.summary
          .addHeading('E2E Web build wait')
          .addRaw(`Artifact wait: ${seconds}s`)
          .write()
        return String(artifact.id)
      }
    }

    await sleep(Math.min(10000, timeoutMs - (now() - started)))
  }

  throw new Error('Timed out waiting for core-e2e-web-build in this workflow run')
}
