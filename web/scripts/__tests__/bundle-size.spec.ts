import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { collectSnapshot, compareSnapshots, parseSnapshot } from '../bundle-size'

const commit = 'a'.repeat(40)
const temporaryDirectories: string[] = []

async function fixture(stats: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'bundle-size-'))
  temporaryDirectories.push(root)
  const files = {
    '.next/diagnostics/route-bundle-stats.json': JSON.stringify(stats),
    '.next/static/chunks/shared.js': 'shared runtime',
    '.next/static/chunks/page.js': 'page code',
    '.next/static/chunks/lazy.js': 'optional renderer',
    '.next/static/chunks/style.css': 'body{color:red}',
    '.next/static/chunks/page.js.map': 'not a client chunk',
    'node_modules/next/package.json': JSON.stringify({ version: '16.3.6' }),
  }
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), content)
  }
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

it('deduplicates shared files per route and counts lazy JS only in emitted totals', async () => {
  const root = await fixture([
    {
      route: '/',
      firstLoadChunkPaths: [
        '.next/static/chunks/shared.js',
        '.next/static/chunks/page.js',
        '.next/static/chunks/shared.js',
      ],
    },
    { route: '/other', firstLoadChunkPaths: ['.next/static/chunks/shared.js'] },
  ])
  const report = await collectSnapshot(root, commit)

  expect(report.routes['/']).toEqual({
    raw: Buffer.byteLength('shared runtimepage code'),
    gzip: gzipSync('shared runtime').length + gzipSync('page code').length,
  })
  expect(report.routes['/other']?.raw).toBe(Buffer.byteLength('shared runtime'))
  expect(report.totals.js.raw).toBe(Buffer.byteLength('shared runtimepage codeoptional renderer'))
  expect(report.totals.css.raw).toBe(Buffer.byteLength('body{color:red}'))
  expect(parseSnapshot(JSON.stringify(report))).toEqual(report)
})

it('fails when a referenced chunk is missing instead of reporting a false reduction', async () => {
  const root = await fixture([
    { route: '/', firstLoadChunkPaths: ['.next/static/chunks/missing.js'] },
  ])
  await expect(collectSnapshot(root, commit)).rejects.toThrow('ENOENT')
})

it.each([
  { stats: [] },
  { stats: [{ route: '/', firstLoadChunkPaths: [] }] },
  { stats: [{ route: '/', files: [] }] },
])('rejects unavailable or incompatible route statistics: %j', async ({ stats }) => {
  await expect(collectSnapshot(await fixture(stats), commit)).rejects.toThrow()
})

it('rejects chunk paths outside the build directory', async () => {
  const root = await fixture([{ route: '/', firstLoadChunkPaths: ['../outside.js'] }])
  await expect(collectSnapshot(root, commit)).rejects.toThrow('outside .next')
})

const snapshot = () => ({
  version: 1 as const,
  commit,
  nextVersion: '16.3.6',
  totals: { js: { raw: 2048, gzip: 1024 }, css: { raw: 0, gzip: 0 } },
  routes: { '/': { raw: 2048, gzip: 1024 } },
})

it('reports increases, decreases, added and removed routes without summing overlapping routes', () => {
  const base = {
    ...snapshot(),
    routes: { '/larger': { raw: 2048, gzip: 1024 }, '/removed': { raw: 4096, gzip: 2048 } },
  }
  const head = {
    ...snapshot(),
    commit: 'b'.repeat(40),
    routes: { '/larger': { raw: 4096, gzip: 2048 }, '/new|route': { raw: 1024, gzip: 512 } },
  }
  const report = compareSnapshots(base, head)

  expect(report).toContain('| <code>/larger</code> | 1.00 KiB | 2.00 KiB | +1.00 KiB | +2.00 KiB |')
  expect(report).toContain('| <code>/removed</code> | 2.00 KiB | Removed | −2.00 KiB | −4.00 KiB |')
  expect(report).toContain(
    '| <code>/new&#124;route</code> | New | 0.50 KiB | +0.50 KiB | +1.00 KiB |',
  )
  expect(report.indexOf('<code>/removed')).toBeLessThan(report.indexOf('<code>/larger'))
  expect(report).toContain('Do not sum routes')
})

it('makes unchanged comparisons and compiler-version changes explicit', () => {
  expect(compareSnapshots(snapshot(), snapshot())).toContain('No route size changes.')
  expect(compareSnapshots(snapshot(), { ...snapshot(), nextVersion: '17.0.0' })).toContain(
    'Next.js versions differ',
  )
})

it('rejects invalid snapshots instead of treating absent metrics as zero', () => {
  expect(() => parseSnapshot(JSON.stringify({ ...snapshot(), totals: {} }))).toThrow('Invalid')
  expect(() =>
    parseSnapshot(JSON.stringify({ ...snapshot(), routes: { '/': { raw: -1, gzip: 0 } } })),
  ).toThrow('Invalid')
})
