import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
// oxlint-disable-next-line vitest/no-import-node-test -- Verify the installed patch independently of the Vite test runner.
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

const require = createRequire(new URL('../../web/package.json', import.meta.url))
const core = dirname(require.resolve('vite/package.json'))
const { snapshotDevtoolsLogs, waitForDevtoolsDrain } = await import(
  pathToFileURL(join(core, 'dist/rolldown/shared/devtools-drain.mjs'))
)

test('waits for log creation and continuous writes before allowing close', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devtools-drain-'))
  try {
    assert.equal((await snapshotDevtoolsLogs(root)).size, 0)
    const dir = join(root, 'node_modules/.rolldown/session')
    await mkdir(dir, { recursive: true })
    let settled = false
    const waiting = waitForDevtoolsDrain(root, 'session', {
      timeout: 3000,
      quietPeriod: 150,
      pollInterval: 10,
    }).then(() => {
      settled = true
    })
    await sleep(180)
    assert.equal(settled, false)
    for (let index = 0; index < 5; index++) {
      await writeFile(join(dir, 'logs.json'), 'x'.repeat(index + 1))
      await sleep(30)
      assert.equal(settled, false)
    }
    await waiting
    assert.equal(settled, true)
    const before = await snapshotDevtoolsLogs(root)
    await writeFile(join(dir, 'logs.json'), 'more data')
    const after = await snapshotDevtoolsLogs(root)
    assert.notEqual(before.get('session'), after.get('session'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('bounds the wait instead of treating a missing log as complete', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devtools-drain-'))
  try {
    await assert.rejects(
      waitForDevtoolsDrain(root, 'missing', {
        timeout: 60,
        quietPeriod: 20,
        pollInterval: 5,
      }),
      /did not settle/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
