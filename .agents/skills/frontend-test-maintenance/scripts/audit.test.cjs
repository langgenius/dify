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
  const rank = (history, focus = 'quality', count = 40) => {
    run(
      'report.cjs',
      'rank',
      path.join(root, 'audit.json'),
      String(count),
      path.join(root, 'queue.json'),
      ...(history ? [path.join(root, history)] : []),
      '--focus',
      focus,
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

test('quality queues survive type volume and only explicit dimension reviews defer candidates', (t) => {
  const f = fixture(t)
  f.write('web/cast.spec.ts', 'const value = {} as never\n'.repeat(100))
  f.write(
    'web/quality.spec.tsx',
    `
vi.mock('./hooks/use-save', () => ({ useSave: vi.fn() }))
it('saves', () => { expect(save).toHaveBeenCalledWith('value') })
`,
  )
  f.write('web/service.spec.ts', `vi.mock('@/service/use-save', () => ({}))`)
  f.write('web/large.spec.ts', 'vi.fn()\n'.repeat(100))
  const baseline = f.scan()
  const ranked = f.rank()
  assert.deepEqual(
    ranked.candidates.map((row) => row.file),
    ['web/quality.spec.tsx'],
  )
  assert.equal(ranked.queues['mock-boundary'].length, 1)
  assert.equal(ranked.queues['behavior-value'].length, 1)
  assert.equal(f.rank(undefined, 'typing').candidates[0].file, 'web/cast.spec.ts')
  assert.deepEqual(
    f.rank(undefined, 'all').candidates.map((row) => row.file),
    ['web/quality.spec.tsx', 'web/cast.spec.ts'],
  )
  const file = baseline.inventory.find((row) => row.file === 'web/quality.spec.tsx')
  const history = {
    scannerSha256: baseline.scannerSha256,
    reviewMethodSha256: ranked.reviewMethodSha256,
    policies: baseline.policies,
    files: [{ ...file, reviews: { typing: { decision: 'cleaned', reason: 'Typed fixture.' } } }],
  }
  const save = () => f.write('reviewed.json', JSON.stringify(history))
  save()
  assert.equal(f.rank('reviewed.json').candidates[0].file, file.file)
  history.files[0].reviews['mock-boundary'] = { decision: 'retain', reason: 'Reviewed boundary.' }
  save()
  const partial = f.rank('reviewed.json')
  assert.equal(partial.queues['mock-boundary'].length, 0)
  assert.equal(partial.candidates[0].selectedFrom, 'behavior-value')
  history.files[0].reviews['behavior-value'] = {
    decision: 'retain',
    reason: 'Reviewed callback contract.',
  }
  save()
  assert.equal(f.rank('reviewed.json').candidates.length, 0)
  history.reviewMethodSha256 = 'old method'
  save()
  assert.equal(f.rank('reviewed.json').reviewHistoryApplicable, false)
  assert.equal(f.rank('reviewed.json').candidates.length, 1)
  history.reviewMethodSha256 = ranked.reviewMethodSha256
  history.files[0].dependencies = [{ file: 'web/owner.ts', sha256: 'changed' }]
  f.write('web/owner.ts', 'export const owner = true')
  save()
  assert.deepEqual(f.rank('reviewed.json').staleReviewFiles, [file.file])
  delete history.files[0].dependencies
  save()
  f.write('web/quality.spec.tsx', `vi.mock('./hooks/use-changed', () => ({}))`)
  f.scan()
  assert.equal(f.rank('reviewed.json').candidates[0].file, file.file)
  f.write('web/docs/test.md', '# Updated policy\n')
  f.scan()
  assert.equal(f.rank('reviewed.json').reviewHistoryApplicable, false)
  delete history.files[0].reviews
  history.files[0].decision = 'cleaned'
  history.files[0].reason = 'Legacy whole-file review'
  save()
  assert.deepEqual(f.rank('reviewed.json').legacyReviewFiles, [file.file])
  assert.equal(f.rank('reviewed.json').deferredReviewed.length, 0)
  assert.throws(() => f.rank('queue.json'), /a ranked list is not a review record/)
})

test('a small shortlist samples both quality dimensions instead of filling with mocks', (t) => {
  const f = fixture(t)
  for (const file of ['a', 'b', 'c'])
    f.write(`web/${file}.spec.ts`, `vi.mock('./hooks/use-owner', () => ({}))`)
  f.write('web/behavior.spec.ts', `it('calls', () => expect(save).toHaveBeenCalled())`)
  f.write('web/types.spec.ts', 'const unsafe = {} as never\n'.repeat(50))
  f.scan()
  const ranked = f.rank(undefined, 'quality', 2)
  assert.deepEqual(
    ranked.candidates.map((row) => row.selectedFrom),
    ['mock-boundary', 'behavior-value'],
  )
  assert.equal(ranked.candidates[1].file, 'web/behavior.spec.ts')
  assert.equal(ranked.queueSizes['mock-boundary'], 3)
  assert.equal(ranked.queueSizes['behavior-value'], 1)
})

test('quality signals distinguish call-only bodies, local shims and service boundaries', (t) => {
  const f = fixture(t)
  f.write(
    'web/app/example.spec.tsx',
    `
vi.mock('./use-owner', () => ({ useOwner: vi.fn() }))
vi.mock('../service/use-api', () => ({ useApi: vi.fn() }))
vi.mock('@/service/use-api', () => ({ useApi: vi.fn() }))
vi.mock('./child', () => ({ default: () => <button>Save</button> }))
vi.mock('@/service/view', () => ({ default: () => <button>Service</button> }))
vi.mock('./plain', () => ({ value: 'not JSX' }))
it('call only', () => {
  expect(save).toHaveBeenCalledWith('data')
  expect(cancel).not.toHaveBeenCalled()
})
it('mixed', () => {
  expect(save).toHaveBeenCalledOnce()
  expect(screen.getByRole('status')).toHaveTextContent('saved')
})
it('snapshot', () => expect(data).toMatchInlineSnapshot('value'))
it('empty', () => render(<div />))
`,
  )
  const report = f.scan()
  const findings = (metric) => report.findings.filter((f) => f.metric === metric)
  assert.equal(findings('mock_internal_hook_or_store_candidate').length, 1)
  assert.equal(findings('local_mock_jsx_factory_candidate').length, 1)
  assert.equal(findings('callback_only_test_candidate').length, 1)
  assert.equal(findings('callback_only_test_candidate')[0].detail, 'call only')
  assert.equal(findings('mock_call_assertions').length, 3)
  assert.equal(findings('snapshots').length, 1)
})

test('comparison includes selected additions, removals and rejects unknown manifest paths', (t) => {
  const f = fixture(t)
  f.write('web/removed.spec.ts', 'const value = {} as never\n')
  f.scan('before.json')
  fs.unlinkSync(path.join(f.root, 'web/removed.spec.ts'))
  f.write('web/test/new.fixture.ts', 'const value = {} as never\n')
  f.scan('after.json')
  const args = ['compare', 'before.json', 'after.json', 'comparison.json'].map(
    (a, i) => (i ? path.join(f.root, a) : a),
  )
  const verify = () => {
    const compared = f.read('comparison.json')
    assert.equal(compared.selectedMetrics.unsafe_assertion_chains.delta, 0)
    assert.deepEqual(compared.changedOutsideSelection, [])
    assert.deepEqual(compared.added, ['web/test/new.fixture.ts'])
    assert.deepEqual(compared.removed, ['web/removed.spec.ts'])
    assert.deepEqual(
      Object.fromEntries(compared.perFile.map(({ file, status }) => [file, status])),
      { 'web/removed.spec.ts': 'removed', 'web/test/new.fixture.ts': 'added' },
    )
  }
  f.write('selected.txt', 'web/removed.spec.ts\nweb/test/new.fixture.ts\n')
  f.run('report.cjs', ...args, path.join(f.root, 'selected.txt'))
  verify()
  f.run('report.cjs', ...args)
  verify()
  f.write('selected.txt', 'web/typo.spec.ts\n')
  assert.throws(
    () => f.run('report.cjs', ...args, path.join(f.root, 'selected.txt')),
    /File missing from both snapshots/,
  )
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
