const { setTimeout: delay } = require('node:timers/promises')

module.exports = async function waitForBuild({
  github,
  context,
  core,
  now = Date.now,
  sleep = delay,
  timeoutMs = 30 * 60 * 1000,
}) {
  const started = now()
  const run = { ...context.repo, run_id: context.runId, per_page: 100 }
  core.info('Waiting for core-e2e-web-build in this workflow run')

  while (now() - started < timeoutMs) {
    const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, run)
    const artifact = artifacts.find((item) => item.name === 'core-e2e-web-build' && !item.expired)
    if (artifact) {
      // A failed-job rerun can reuse a successful producer's artifact from this run.
      // The workflow still requires core-build to succeed, including its post steps.
      const seconds = Math.round((now() - started) / 1000)
      core.info(`Web build artifact ready after ${seconds}s`)
      await core.summary
        .addHeading('E2E Web build wait')
        .addRaw(`Artifact wait: ${seconds}s`)
        .write()
      return String(artifact.id)
    }

    const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
      ...run,
      filter: 'latest',
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

    await sleep(Math.min(10000, timeoutMs - (now() - started)))
  }

  throw new Error('Timed out waiting for core-e2e-web-build in this workflow run')
}
