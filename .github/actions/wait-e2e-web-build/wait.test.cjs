const assert = require('node:assert/strict')
const { test } = require('node:test')
const waitForBuild = require('./wait.cjs')

function fixture({ artifacts = [], jobs = [producer], error, runAttempt = 2 } = {}) {
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
      runAttempt,
      github: {
        rest: {
          actions: { listWorkflowRunArtifacts: 'artifacts', listJobsForWorkflowRunAttempt: 'jobs' },
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

const producer = {
  name: 'Run Web Full-Stack E2E / Prepare Core E2E Web Build',
  status: 'in_progress',
  run_attempt: 2,
}
const artifact = {
  id: 42,
  name: 'core-e2e-web-build-2',
  expired: false,
  created_at: '2026-09-22T04:08:11Z',
}
const oldArtifact = {
  ...artifact,
  id: 41,
  name: 'core-e2e-web-build-1',
  created_at: '2026-09-22T03:08:11Z',
}
const successfulProducer = {
  ...producer,
  status: 'completed',
  conclusion: 'success',
  steps: [
    {
      name: 'Upload Web build',
      conclusion: 'success',
      started_at: '2026-09-22T04:08:08Z',
      completed_at: '2026-09-22T04:08:12Z',
    },
  ],
}

test('starts consuming the current artifact without waiting for producer cache saves', async () => {
  const { options, calls } = fixture({ artifacts: (elapsed) => (elapsed ? [artifact] : []) })
  assert.equal(await waitForBuild(options), '42')
  assert.equal(options.now(), 10000)
  assert.deepEqual(
    calls.map((call) => call.endpoint),
    ['jobs', 'artifacts', 'jobs', 'artifacts'],
  )
  for (const { endpoint, params } of calls) {
    assert.equal(params.run_id, 123)
    assert.equal(params.owner, 'owner')
    assert.equal(params.repo, 'repo')
    if (endpoint === 'jobs') assert.equal(params.attempt_number, 2)
  }
})

test('full reruns ignore the old artifact until the rebuilding producer publishes this attempt', async () => {
  const { options } = fixture({
    artifacts: (elapsed) => (elapsed ? [oldArtifact, artifact] : [oldArtifact]),
  })
  assert.equal(await waitForBuild(options), '42')
  assert.equal(options.now(), 10000)
})

test('does not use an old artifact before the current producer appears or while it is queued', async () => {
  const { options } = fixture({
    artifacts: [oldArtifact],
    jobs: (elapsed) => (elapsed ? [{ ...producer, status: 'queued' }] : []),
  })
  await assert.rejects(waitForBuild(options), /Timed out/)
})

test('consumer-only reruns reuse the actual successful upload despite a relabeled run_attempt', async () => {
  const { options } = fixture({
    runAttempt: 4,
    artifacts: [oldArtifact, artifact],
    jobs: [{ ...successfulProducer, run_attempt: 4 }],
  })
  assert.equal(await waitForBuild(options), '42')
  assert.equal(options.now(), 0)
})

for (const conclusion of ['failure', 'cancelled', 'skipped']) {
  test(`does not fall back to an old artifact when the producer finishes with ${conclusion}`, async () => {
    const { options } = fixture({
      artifacts: [oldArtifact, artifact],
      jobs: [{ ...producer, status: 'completed', conclusion }],
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

test('completed rebuilt producers select their upload instead of the old artifact', async () => {
  const { options } = fixture({ artifacts: [oldArtifact, artifact], jobs: [successfulProducer] })
  assert.equal(await waitForBuild(options), '42')
})

test('allows artifact visibility to catch up after a successful producer finishes', async () => {
  const { options } = fixture({
    artifacts: (elapsed) => (elapsed ? [oldArtifact, artifact] : [oldArtifact]),
    jobs: [successfulProducer],
  })
  assert.equal(await waitForBuild(options), '42')
  assert.equal(options.now(), 10000)
})

test('does not reuse artifacts without a successful matching upload step', async () => {
  const { options } = fixture({
    artifacts: [artifact],
    jobs: [{ ...successfulProducer, steps: [] }],
  })
  await assert.rejects(waitForBuild(options), /Timed out/)
})

test('reports API errors rather than silently waiting until timeout', async () => {
  const { options } = fixture({ error: new Error('Resource not accessible by integration') })
  await assert.rejects(waitForBuild(options), /Resource not accessible/)
  assert.equal(options.now(), 0)
})

test('completed current-attempt uploads tolerate artifact and job timestamp skew', async () => {
  const { options } = fixture({
    artifacts: [{ ...artifact, created_at: '2026-09-22T05:08:11Z', workflow_run: { id: 123 } }],
    jobs: [successfulProducer],
  })
  assert.equal(await waitForBuild(options), '42')
  assert.equal(options.now(), 0)
})

for (const [label, artifacts] of [
  ['missing', []],
  ['expired', [{ ...artifact, expired: true }]],
  ['unrelated name', [{ ...artifact, name: 'unrelated' }]],
  ['wrong workflow run', [{ ...artifact, workflow_run: { id: 456 } }]],
  ['future attempt', [{ ...artifact, name: 'core-e2e-web-build-3' }]],
  ['older attempt outside upload window', [{ ...oldArtifact, created_at: '2026-09-22T05:08:11Z' }]],
]) {
  test(`completed producer rejects ${label} artifacts`, async () => {
    const { options } = fixture({ artifacts, jobs: [successfulProducer] })
    await assert.rejects(waitForBuild(options), /Timed out/)
    assert.equal(options.now(), 20000)
  })
}

for (const jobs of [[], [{ ...producer, status: 'queued' }]]) {
  test(`current-attempt artifact requires an active or successful producer: ${jobs[0]?.status ?? 'missing'}`, async () => {
    const { options } = fixture({ artifacts: [artifact], jobs })
    await assert.rejects(waitForBuild(options), /Timed out/)
  })
}

test('in-progress producer cannot consume another workflow run artifact with the current name', async () => {
  const { options } = fixture({
    artifacts: [{ ...artifact, workflow_run: { id: 456 } }],
  })
  await assert.rejects(waitForBuild(options), /Timed out/)
})

for (const conclusion of ['failure', 'cancelled', 'skipped', undefined]) {
  test(`current-attempt name cannot bypass unsuccessful upload: ${conclusion}`, async () => {
    const { options } = fixture({
      artifacts: [{ ...artifact, created_at: '2026-09-22T05:08:11Z' }],
      jobs: [{ ...successfulProducer, steps: [{ ...successfulProducer.steps[0], conclusion }] }],
    })
    await assert.rejects(waitForBuild(options), /Timed out/)
  })
}

test('timestamp skew does not let an older attempt bypass its successful upload window', async () => {
  const { options } = fixture({
    runAttempt: 4,
    artifacts: [{ ...artifact, created_at: '2026-09-22T05:08:11Z' }],
    jobs: [{ ...successfulProducer, run_attempt: 4 }],
  })
  await assert.rejects(waitForBuild(options), /Timed out/)
})

test('artifact run identity accepts the environment string used by the downloader', async () => {
  const { options } = fixture({
    artifacts: [{ ...artifact, workflow_run: { id: 123 } }],
    jobs: [successfulProducer],
  })
  options.context.runId = '123'
  assert.equal(await waitForBuild(options), '42')
  assert.equal(options.now(), 0)
})
