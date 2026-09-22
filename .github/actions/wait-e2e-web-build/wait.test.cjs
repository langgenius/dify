const assert = require('node:assert/strict')
const { test } = require('node:test')
const waitForBuild = require('./wait.cjs')

function fixture({ artifacts = [], jobs = [], error } = {}) {
  let elapsed = 0
  const calls = []
  const summary = {
    addHeading() {
      return this
    },
    addRaw() {
      return this
    },
    async write() {},
  }
  return {
    calls,
    options: {
      context: { repo: { owner: 'owner', repo: 'repo' }, runId: 123 },
      core: { info() {}, summary },
      github: {
        rest: {
          actions: { listWorkflowRunArtifacts: 'artifacts', listJobsForWorkflowRun: 'jobs' },
        },
        async paginate(endpoint, params) {
          calls.push({ endpoint, params })
          if (error) throw error
          const values = endpoint === 'artifacts' ? artifacts : jobs
          return typeof values === 'function' ? values(elapsed) : values
        },
      },
      now: () => elapsed,
      sleep: async (ms) => {
        elapsed += ms
      },
      timeoutMs: 20000,
    },
  }
}

const artifact = { id: 42, name: 'core-e2e-web-build', expired: false }

test('starts consuming the artifact without waiting for producer cache saves', async () => {
  const { options, calls } = fixture({
    artifacts: (elapsed) => (elapsed ? [artifact] : []),
    jobs: [{ name: 'Run Web Full-Stack E2E / Prepare Core E2E Web Build', status: 'in_progress' }],
  })
  assert.equal(await waitForBuild(options), '42')
  assert.equal(options.now(), 10000)
  assert.deepEqual(
    calls.map((call) => call.endpoint),
    ['artifacts', 'jobs', 'artifacts'],
  )
  for (const { params } of calls) {
    assert.equal(params.run_id, 123)
    assert.equal(params.owner, 'owner')
    assert.equal(params.repo, 'repo')
  }
})

test('failed-job reruns can reuse the successful build artifact from the same run', async () => {
  const { options, calls } = fixture({ artifacts: [artifact] })
  assert.equal(await waitForBuild(options), '42')
  assert.equal(calls.length, 1)
})

for (const conclusion of ['failure', 'cancelled', 'skipped']) {
  test(`fails promptly when the producer finishes with ${conclusion}`, async () => {
    const { options } = fixture({
      jobs: [
        {
          name: 'Run Web Full-Stack E2E / Prepare Core E2E Web Build',
          status: 'completed',
          conclusion,
        },
      ],
    })
    await assert.rejects(waitForBuild(options), new RegExp(`Web build finished with ${conclusion}`))
    assert.equal(options.now(), 0)
  })
}

test('ignores unrelated and expired artifacts and stops at the deadline', async () => {
  const { options } = fixture({
    artifacts: [
      { ...artifact, expired: true },
      { ...artifact, name: 'other' },
    ],
  })
  await assert.rejects(waitForBuild(options), /Timed out/)
  assert.equal(options.now(), 20000)
})

test('allows artifact visibility to catch up after a successful producer finishes', async () => {
  const { options } = fixture({
    artifacts: (elapsed) => (elapsed ? [artifact] : []),
    jobs: [{ name: 'Prepare Core E2E Web Build', status: 'completed', conclusion: 'success' }],
  })
  assert.equal(await waitForBuild(options), '42')
})

test('reports API errors rather than silently waiting until timeout', async () => {
  const { options } = fixture({ error: new Error('Resource not accessible by integration') })
  await assert.rejects(waitForBuild(options), /Resource not accessible/)
  assert.equal(options.now(), 0)
})
