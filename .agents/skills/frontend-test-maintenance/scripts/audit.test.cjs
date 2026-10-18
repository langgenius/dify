// Run from the repository root: node --test .agents/skills/frontend-test-maintenance/scripts/audit.test.cjs
const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

const repo = path.resolve(__dirname, '../../../..')
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test-maintenance-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'node_modules'))
  fs.symlinkSync(
    path.dirname(require.resolve('typescript/package.json', { paths: [repo] })),
    path.join(root, 'node_modules/typescript'),
    'junction',
  )
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  write('.gitignore', 'node_modules\n*.json\n')
  write('web/docs/test.md', '# Policy\nProtect observable behavior.\n')
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'],
    { cwd: root },
  )
  const run = (script, ...args) =>
    execFileSync(process.execPath, [path.join(__dirname, script), ...args], { encoding: 'utf8' })
  const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
  const scan = (file = 'audit.json') => {
    run('audit.cjs', root, path.join(root, file), 'web')
    return read(file)
  }
  const rank = (history) => {
    run(
      'report.cjs',
      'rank',
      path.join(root, 'audit.json'),
      '40',
      path.join(root, 'queue.json'),
      ...(history ? [path.join(root, history)] : []),
    )
    return read('queue.json')
  }
  return { root, write, read, run, scan, rank }
}

test('render-existence detection follows render subjects, not business-state names', (t) => {
  const f = fixture(t)
  f.write(
    'web/example.spec.tsx',
    `
import { render, render as mount } from '@testing-library/react'
import { vi as mocker } from 'vite-plus/test'
const { container, baseElement: root } = mount(<div />)
const view = render(<div />)
expect(container).toBeTruthy()
expect(root).toBeDefined()
expect(view).toBeTruthy()
expect(view.container).toBeDefined()
expect(render(<div />)).toBeTruthy()
expect(render(<div />).baseElement).toBeDefined()
expect(renderedStore.getState().backupDraft).toBeDefined()
expect(container.querySelector('button')).toBeTruthy()
expect(view.container.textContent).toBeTruthy()
expect(containerState).toBeDefined()
expect({ render: 'business field' }).toBeTruthy()
const text = 'vi.fn(); value as never; @ts-ignore'
// vi.mock('not-a-call')
const bridge = {} as unknown as Widget
const constant = [] as const
mocker.mock(import('./service'))
mocker.fn()
afterEach(() => { mocker.clearAllMocks(); mocker.restoreAllMocks() })
`,
  )
  const report = f.scan()
  const count = (metric) => report.findings.filter((finding) => finding.metric === metric).length
  assert.equal(count('render_existence_assertion_candidate'), 6)
  assert.equal(count('type_assertion_nodes'), 2)
  assert.equal(count('unsafe_assertion_chains'), 1)
  assert.equal(count('as_const'), 1)
  assert.equal(count('module_mock'), 1)
  assert.equal(count('vi_fn'), 1)
  assert.equal(count('ts_ignore'), 0)
  assert.equal(count('afterEach_mock_reset_candidate'), 1)
  assert.equal(count('afterEach_mock_restore'), 1)
})

test('specific candidates outrank large mocks; only current explicit reviews defer files', (t) => {
  const f = fixture(t)
  f.write('web/large.spec.ts', 'vi.fn()\n'.repeat(100))
  f.write('web/clear.spec.ts', 'afterEach(() => vi.clearAllMocks())\n')
  f.write('web/cast.spec.ts', 'const value = {} as never\n')
  const baseline = f.scan()
  const ranked = f.rank()
  assert.deepEqual(
    ranked.candidates.map((row) => row.file),
    ['web/cast.spec.ts', 'web/clear.spec.ts', 'web/large.spec.ts'],
  )
  assert.equal(ranked.candidates[2].contextScore, 10)
  const reviewed = baseline.inventory.find((row) => row.file === 'web/cast.spec.ts')
  f.write(
    'reviewed.json',
    JSON.stringify({
      scannerSha256: baseline.scannerSha256,
      policies: baseline.policies,
      files: [{ ...reviewed, decision: 'retain', reason: 'Reviewed external boundary adapter.' }],
    }),
  )
  const next = f.rank('reviewed.json')
  assert.equal(next.candidates[0].file, 'web/clear.spec.ts')
  assert.equal(next.deferredReviewed[0].file, reviewed.file)
  f.write('web/cast.spec.ts', 'const value = changed as never\n')
  f.scan()
  assert.equal(f.rank('reviewed.json').candidates[0].file, reviewed.file)
  f.write('web/cast.spec.ts', 'const value = {} as never\n')
  f.write('web/docs/test.md', '# Updated policy\n')
  f.scan()
  const changedPolicy = f.rank('reviewed.json')
  assert.equal(changedPolicy.reviewHistoryApplicable, false)
  assert.equal(changedPolicy.deferredReviewed.length, 0)
  assert.equal(changedPolicy.candidates[0].file, reviewed.file)
  assert.throws(() => f.rank('queue.json'), /a ranked list is not a review record/)
})

test('comparison exposes debt moved to new helpers and rejects policy drift', (t) => {
  const f = fixture(t)
  f.write('web/owner.spec.ts', 'const value = {} as never\n')
  f.write('web/removed.spec.ts', 'vi.fn()\n')
  f.scan('before.json')
  f.write('selected.txt', 'web/owner.spec.ts\n')
  f.write('web/owner.spec.ts', 'const value = {}\n')
  f.write('web/__tests__/new.fixture.ts', 'const value = {} as never\n')
  fs.unlinkSync(path.join(f.root, 'web/removed.spec.ts'))
  f.scan('after.json')
  const args = ['compare', 'before.json', 'after.json', 'comparison.json', 'selected.txt'].map(
    (a, i) => (i ? path.join(f.root, a) : a),
  )
  f.run('report.cjs', ...args)
  const compared = f.read('comparison.json')
  assert.equal(compared.selectedMetrics.unsafe_assertion_chains.delta, -1)
  assert.equal(compared.wholeScopeMetrics.unsafe_assertion_chains.delta, 0)
  assert.equal(compared.outsideSelectionMetrics.unsafe_assertion_chains.delta, 1)
  assert.deepEqual(compared.removed, ['web/removed.spec.ts'])
  f.write('web/docs/test.md', '# New policy\n')
  f.scan('after.json')
  assert.throws(() => f.run('report.cjs', ...args), /policy changed/)
  f.write('web/broken.spec.ts', 'const = ???')
  const failed = spawnSync(
    process.execPath,
    [path.join(__dirname, 'audit.cjs'), f.root, path.join(f.root, 'broken.json'), 'web'],
    { encoding: 'utf8' },
  )
  assert.notEqual(failed.status, 0)
  assert.match(failed.stderr, /Cannot reliably parse/)
})
