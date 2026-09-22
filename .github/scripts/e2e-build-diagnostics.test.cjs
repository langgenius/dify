const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { compareInputs, inspectCache } = require('./e2e-build-diagnostics.cjs')

test('inventories cache versions without following symlinks and bounds the largest-file report', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cache-inventory-'))
  try {
    const cache = path.join(directory, 'cache')
    const version = path.join(cache, 'turbopack/version/chunks')
    fs.mkdirSync(version, { recursive: true })
    for (let i = 1; i <= 25; i++) fs.writeFileSync(path.join(version, `${i}.sst`), Buffer.alloc(i))
    fs.writeFileSync(path.join(cache, 'metadata.json'), '{}')
    fs.writeFileSync(path.join(directory, 'outside'), Buffer.alloc(1000))
    fs.symlinkSync(path.join(directory, 'outside'), path.join(cache, 'link'))
    const result = inspectCache(cache)
    assert.equal(result.bytes, 327)
    assert.equal(result.fileCount, 26)
    assert.deepEqual(result.directories, [
      { path: 'turbopack/version', bytes: 325, fileCount: 25 },
      { path: '.', bytes: 2, fileCount: 1 },
    ])
    assert.equal(result.largestFiles.length, 20)
    assert.equal(result.largestFiles[0].bytes, 25)
    assert.equal(result.largestFiles.at(-1).bytes, 6)
    assert.deepEqual(inspectCache(path.join(directory, 'missing')), {
      bytes: 0,
      fileCount: 0,
      directories: [],
      largestFiles: [],
    })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('distinguishes missing baselines from identical inputs', () => {
  const inputs = {
    commit: 'old',
    files: { 'web/a.ts': '1' },
    node: '24',
    next: '16',
    envFileHash: null,
  }
  assert.equal(compareInputs(null, inputs), null)
  assert.deepEqual(compareInputs(inputs, { ...inputs, commit: 'new' }), {
    previousCommit: 'old',
    changedFiles: [],
    nodeChanged: false,
    nextChanged: false,
    envFileChanged: false,
  })
})

test('reports additions, deletions and edits independently of runtime changes', () => {
  const previous = {
    files: { removed: '1', edited: '1', same: '1' },
    node: '22',
    next: '15',
    envFileHash: 'a',
  }
  const current = {
    files: { added: '2', edited: '2', same: '1' },
    node: '24',
    next: '16',
    envFileHash: 'b',
  }
  assert.deepEqual(compareInputs(previous, current), {
    previousCommit: undefined,
    changedFiles: ['added', 'edited', 'removed'],
    nodeChanged: true,
    nextChanged: true,
    envFileChanged: true,
  })
})

test('collects a fallback baseline without persisting failed builds or environment contents', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-build-diagnostics-'))
  try {
    const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' })
    git('init')
    fs.mkdirSync(path.join(directory, 'web/.next/cache'), { recursive: true })
    fs.writeFileSync(path.join(directory, 'web/input.ts'), 'export const value = 1')
    git('add', 'web/input.ts')
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'fixture')
    fs.writeFileSync(path.join(directory, 'web/.env.local'), 'SECRET=do-not-print-me')
    const summary = path.join(directory, 'summary.md')
    const run = (mode, outcome) =>
      execFileSync(process.execPath, [path.join(__dirname, 'e2e-build-diagnostics.cjs'), mode], {
        cwd: directory,
        env: {
          ...process.env,
          GITHUB_STEP_SUMMARY: summary,
          E2E_CACHE_HIT: 'false',
          E2E_CACHE_MATCHED_KEY: 'fallback-key',
          E2E_CACHE_RESTORE_STARTED: String(Date.now()),
          E2E_BUILD_OUTCOME: outcome,
        },
      })
    run('before', '')
    run('after', 'failure')
    const metadata = path.join(directory, 'web/.next/cache/dify-e2e-inputs.json')
    assert.equal(fs.existsSync(metadata), false)
    fs.writeFileSync(
      path.join(directory, 'e2e/.logs/web-build.log'),
      '✓ Compiled successfully in 2.3min\n',
    )
    run('after', 'success')
    assert.equal(fs.existsSync(metadata), true)
    const output = fs.readFileSync(summary, 'utf8')
    assert.match(output, /"match":\s*"fallback"/)
    assert.match(output, /Compiled successfully in 2.3min/)
    assert.match(output, /"compilerDurationMs":\s*138000/)
    assert.doesNotMatch(output, /do-not-print-me/)
    assert.doesNotMatch(fs.readFileSync(metadata, 'utf8'), /do-not-print-me/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
