const fs = require('node:fs')
const assert = require('node:assert/strict')
const test = require('node:test')
const source = fs.readFileSync(
  require('node:path').join(__dirname, '../workflows/size-labeler.yml'),
  'utf8',
)
const script = source
  .replace(/\r\n/g, '\n')
  .split('          script: |\n')[1]
  .split('\n')
  .map((l) => l.replace(/^            /, ''))
  .join('\n')
const run = new (Object.getPrototypeOf(async function () {}).constructor)(
  'github',
  'context',
  'core',
  script,
)
async function scenario(files, existing = [], changed = files.length) {
  const calls = []
  const warnings = []
  const api = {
    pulls: {
      get: async () => ({ data: { changed_files: changed } }),
      listFiles: 'files',
    },
    issues: {
      listLabelsOnIssue: 'labels',
      addLabels: async (p) => calls.push(['add', p.labels[0]]),
      removeLabel: async (p) => calls.push(['remove', p.name]),
    },
  }
  await run(
    {
      rest: api,
      paginate: async (endpoint) =>
        endpoint === 'files' ? files : existing.map((name) => ({ name })),
    },
    {
      repo: { owner: 'test', repo: 'repo' },
      payload: { pull_request: { number: 1 } },
    },
    { warning: (s) => warnings.push(s) },
  )
  return { calls, warnings }
}
for (const [n, label] of [
  [0, 'XS'],
  [9, 'XS'],
  [10, 'S'],
  [29, 'S'],
  [30, 'M'],
  [99, 'M'],
  [100, 'L'],
  [499, 'L'],
  [500, 'XL'],
  [999, 'XL'],
  [1000, 'XXL'],
]) {
  test(`threshold ${n}`, async () =>
    assert.deepEqual((await scenario([{ filename: 'a.py', additions: n, deletions: 0 }])).calls, [
      ['add', `size:${label}`],
    ]))
}
test('count deletions', async () =>
  assert.deepEqual((await scenario([{ filename: 'a.py', additions: 0, deletions: 30 }])).calls, [
    ['add', 'size:M'],
  ]))
test('ignore nested lockfiles', async () =>
  assert.deepEqual(
    (
      await scenario([
        { filename: 'api/uv.lock', additions: 9000, deletions: 5 },
        { filename: 'web/pnpm-lock.yaml', additions: 5000, deletions: 0 },
      ])
    ).calls,
    [['add', 'size:XS']],
  ))
test('replace stale size only', async () =>
  assert.deepEqual(
    (await scenario([{ filename: 'a.py', additions: 10, deletions: 0 }], ['size:L', 'bug', 'web']))
      .calls,
    [
      ['add', 'size:S'],
      ['remove', 'size:L'],
    ],
  ))
test('idempotent', async () => assert.deepEqual((await scenario([], ['size:XS', 'bug'])).calls, []))
test('incomplete file list', async () => {
  const r = await scenario([], ['size:L'], 3001)
  assert.deepEqual(r.calls, [])
  assert.equal(r.warnings.length, 1)
})
