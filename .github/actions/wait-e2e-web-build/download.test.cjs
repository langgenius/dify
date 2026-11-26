const assert = require('node:assert/strict')
const { access } = require('node:fs/promises')
const { test } = require('node:test')
const downloadWebBuild = require('./download.cjs')

function fixture({ downloadFailures = 0, producerFails = false } = {}) {
  const calls = []
  const sleeps = []
  const env = {
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_RUN_ID: '123',
    GITHUB_RUN_ATTEMPT: '4',
    GH_TOKEN: 'test-token',
  }
  const execute = async (command, args) => {
    calls.push({ command, args })
    if (command === 'tar') return { stdout: '' }
    if (args[0] === 'run') {
      if (downloadFailures > 0) {
        downloadFailures--
        throw new Error('artifact download failed')
      }
      return { stdout: '' }
    }
    if (args[1].includes('/jobs?')) {
      return {
        stdout: JSON.stringify([
          {
            jobs: [
              {
                name: 'Run Web Full-Stack E2E / Prepare Core E2E Web Build',
                status: 'completed',
                conclusion: producerFails ? 'failure' : 'success',
                steps: [
                  {
                    name: 'Upload Web build',
                    conclusion: 'success',
                    started_at: '2026-09-22T04:08:08Z',
                    completed_at: '2026-09-22T04:08:12Z',
                  },
                ],
              },
            ],
          },
        ]),
      }
    }
    if (args[1].includes('/artifacts?')) {
      return {
        stdout: JSON.stringify([
          { artifacts: [] },
          {
            artifacts: [
              {
                id: 42,
                name: 'core-e2e-web-build-2',
                created_at: '2026-09-22T04:08:11Z',
                expired: false,
              },
            ],
          },
        ]),
      }
    }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
  }
  const sleep = async (ms) => {
    sleeps.push(ms)
  }
  return { calls, sleeps, options: { env, execute, webDir: '/test/web', sleep } }
}

function incompleteMetadataResponse() {
  return Object.assign(new Error('gh api failed: unexpected end of JSON input'), {
    code: 1,
    stdout: '[]',
    stderr: 'unexpected end of JSON input\n',
  })
}

test('downloads the producer-selected artifact on consumer-only reruns without a second metadata lookup', async () => {
  const { calls, options } = fixture()
  await downloadWebBuild({
    ...options,
    async execute(command, args) {
      if (args[0] === 'api' && args[1].endsWith('/artifacts/42')) {
        throw new Error('gh: Not Found (HTTP 404)')
      }
      return options.execute(command, args)
    },
  })
  assert.match(calls[0].args[1], /runs\/123\/attempts\/4\/jobs/)
  const download = calls.find(({ args }) => args[0] === 'run')
  assert.deepEqual(download.args.slice(0, 7), [
    'run',
    'download',
    '123',
    '--repo',
    'owner/repo',
    '--name',
    'core-e2e-web-build-2',
  ])
  const extract = calls.at(-1)
  assert.equal(extract.command, 'tar')
  assert.deepEqual(extract.args.slice(-2), ['-C', '/test/web'])
  await assert.rejects(access(download.args.at(-1)), { code: 'ENOENT' })
})

for (const list of ['jobs', 'artifacts']) {
  test(`retries an incomplete ${list} response before downloading the build`, async () => {
    const { calls, options } = fixture()
    let requests = 0
    await downloadWebBuild({
      ...options,
      async execute(command, args) {
        if (args[0] === 'api' && args[1].includes(`/${list}?`)) {
          requests++
          if (requests === 1) throw incompleteMetadataResponse()
        }
        return options.execute(command, args)
      },
    })
    assert.equal(requests, 2)
    assert.equal(calls.at(-1).command, 'tar')
  })
}

test('stops after a second incomplete jobs response', async () => {
  const { options } = fixture()
  const error = incompleteMetadataResponse()
  let requests = 0
  await assert.rejects(
    downloadWebBuild({
      ...options,
      async execute() {
        requests++
        throw error
      },
    }),
    (actual) => actual === error,
  )
  assert.equal(requests, 2)
})

test('fails immediately when the jobs request is forbidden', async () => {
  const { options } = fixture()
  const error = Object.assign(new Error('gh api failed (HTTP 403)'), {
    code: 1,
    stderr: 'gh: Resource not accessible by integration (HTTP 403)\n',
  })
  let requests = 0
  await assert.rejects(
    downloadWebBuild({
      ...options,
      async execute() {
        requests++
        throw error
      },
    }),
    (actual) => actual === error,
  )
  assert.equal(requests, 1)
})

test('retries a listed artifact whose archive is temporarily unreadable', async () => {
  const { calls, sleeps, options } = fixture({ downloadFailures: 1 })
  await downloadWebBuild(options)
  assert.deepEqual(sleeps, [5_000])
  assert.equal(calls.filter(({ args }) => args[0] === 'run').length, 2)
  assert.equal(calls.at(-1).command, 'tar')
})

test('does not extract a failed download and removes its temporary directory', async () => {
  const { calls, sleeps, options } = fixture({ downloadFailures: 3 })
  await assert.rejects(downloadWebBuild(options), /artifact download failed/)
  assert.deepEqual(sleeps, [5_000, 10_000])
  assert.equal(calls.filter(({ args }) => args[0] === 'run').length, 3)
  assert.equal(
    calls.some(({ command }) => command === 'tar'),
    false,
  )
  await assert.rejects(access(calls.at(-1).args.at(-1)), { code: 'ENOENT' })
})

test('does not download or extract when the producer fails', async () => {
  const { calls, options } = fixture({ producerFails: true })
  await assert.rejects(downloadWebBuild(options), /Web build finished with failure/)
  assert.equal(calls.length, 1)
})

test('requires CI metadata and credentials before starting preparation', async () => {
  const { calls, options } = fixture()
  for (const key of Object.keys(options.env)) {
    await assert.rejects(
      downloadWebBuild({ ...options, env: { ...options.env, [key]: '' } }),
      /requires GITHUB/,
    )
  }
  assert.equal(calls.length, 0)
})
