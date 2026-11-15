const assert = require('node:assert/strict')
const { access } = require('node:fs/promises')
const { test } = require('node:test')
const downloadWebBuild = require('./download.cjs')

function fixture({ downloadFails = false, producerFails = false } = {}) {
  const calls = []
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
      if (downloadFails) throw new Error('artifact download failed')
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
    assert.equal(args[1], 'repos/owner/repo/actions/artifacts/42')
    return { stdout: JSON.stringify({ name: 'core-e2e-web-build-2' }) }
  }
  return { calls, options: { env, execute, webDir: '/test/web' } }
}

test('downloads the producer-selected artifact on consumer-only reruns, including paginated results', async () => {
  const { calls, options } = fixture()
  await downloadWebBuild(options)
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

test('does not extract a failed download and removes its temporary directory', async () => {
  const { calls, options } = fixture({ downloadFails: true })
  await assert.rejects(downloadWebBuild(options), /artifact download failed/)
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
