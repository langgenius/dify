import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { collect, compare, parseAnalysis, parseSnapshot, staticClosure } from '../bundle-analysis'

const dirs: string[] = []
const sha = 'a'.repeat(40)
const graph = () => ({
  meta: { bundler: 'rolldown', version: '1.2.9' },
  chunks: [
    {
      name: 'entry.js',
      size: 5,
      type: 'static-entry',
      entryModule: 0,
      imports: [
        { type: 'static', targetChunkIndex: 1 },
        { type: 'dynamic', targetChunkIndex: 2 },
      ],
    },
    {
      name: 'shared.js',
      size: 6,
      type: 'common',
      imports: [{ type: 'static', targetChunkIndex: 0 }],
    },
    {
      name: 'lazy.js',
      size: 4,
      type: 'dynamic-entry',
      entryModule: 1,
      imports: [{ type: 'static', targetChunkIndex: 1 }],
    },
  ],
  modules: [
    { path: 'app/view.tsx', size: 5 },
    { path: 'app/lazy.tsx', size: 4 },
    { path: '../node_modules/.pnpm/@scope+pkg@1/node_modules/@scope/pkg/index.js', size: 6 },
  ],
})
async function fixture(analysis = graph()) {
  const root = await mkdtemp(join(tmpdir(), 'vinext-analysis-test-'))
  dirs.push(root)
  const client = join(root, 'dist/client')
  await mkdir(join(client, '_next/static/css'), { recursive: true })
  await mkdir(join(root, 'node_modules/vinext'), { recursive: true })
  await writeFile(
    join(root, 'node_modules/vinext/package.json'),
    JSON.stringify({ version: '1.0.0' }),
  )
  await writeFile(join(client, 'bundle-analysis.json'), JSON.stringify(analysis))
  for (const [name, data] of Object.entries({
    'entry.js': 'entry',
    'shared.js': 'shared',
    'lazy.js': 'lazy',
    '_next/static/css/app.css': 'css',
  }))
    await writeFile(join(client, name), data)
  return root
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

it('deduplicates cycles and shared dependencies without following dynamic edges', () => {
  expect([...staticClosure(parseAnalysis(JSON.stringify(graph())), 0)]).toEqual([0, 1])
  expect([...staticClosure(parseAnalysis(JSON.stringify(graph())), 2)]).toEqual([2, 1, 0])
})
it('measures emitted files independently of attribution and groups scoped packages', async () => {
  const result = await collect(await fixture(), sha)
  expect(result.totals.js).toEqual({
    raw: 15,
    gzip: gzipSync('entry').length + gzipSync('shared').length + gzipSync('lazy').length,
  })
  expect(result.entries['static-entry: app/view.tsx']?.raw).toBe(11)
  expect(result.totals.css.raw).toBe(3)
  expect(result.packages).toEqual({ '@scope/pkg': 6 })
  expect(parseSnapshot(JSON.stringify(result))).toEqual(result)
})
it('fails on missing emitted files instead of reporting false savings', async () => {
  const root = await fixture()
  await rm(join(root, 'dist/client/lazy.js'))
  await expect(collect(root, sha)).rejects.toThrow('ENOENT')
})
it('rejects incompatible graph data and dangling references', () => {
  const invalid = graph()
  invalid.chunks[0]!.imports![0]!.targetChunkIndex = 99
  expect(() => parseAnalysis(JSON.stringify(invalid))).toThrow('Invalid')
  expect(() => parseAnalysis('{}')).toThrow('Invalid')
})
it('rejects out-of-output chunk paths', async () => {
  const invalid = graph()
  invalid.chunks[0]!.name = '../outside.js'
  await expect(collect(await fixture(invalid), sha)).rejects.toThrow('outside')
})
it('reports additions, removals, gzip differences and package attribution without calling entries pages', async () => {
  const base = await collect(await fixture(), sha)
  const merged = {
    ...base,
    commit: 'b'.repeat(40),
    entries: { 'dynamic-entry: app/new|view.tsx': { raw: 4096, gzip: 2048 } },
    packages: { '@scope/pkg': 1030 },
  }
  const report = compare(base, merged)
  expect(report).toContain('New')
  expect(report).toContain('Removed')
  expect(report).toContain('new&#124;view.tsx')
  expect(report).toContain('New entry')
  expect(report).not.toContain('+2.00 KiB')
  expect(report).toContain('+1.00 KiB')
  expect(report).toContain('not page first-load metrics')
  expect(() => parseSnapshot(JSON.stringify({ ...base, totals: {} }))).toThrow('Invalid')
})
