import { appendFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

type Size = { raw: number; gzip: number }
type Analysis = {
  meta: { bundler: string; version: string }
  chunks: {
    name: string
    size: number
    type: string
    entryModule?: number
    imports?: { targetChunkIndex: number; type: string }[]
  }[]
  modules: { path: string; size: number }[]
}
type Snapshot = {
  version: 1
  commit: string
  vinext: string
  rolldown: string
  totals: { js: Size; css: Size }
  entries: Record<string, Size>
  packages: Record<string, number>
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const bytes = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
const size = (v: unknown): v is Size => record(v) && bytes(v.raw) && bytes(v.gzip)
const empty = (): Size => ({ raw: 0, gzip: 0 })
const add = (a: Size, b: Size): Size => ({ raw: a.raw + b.raw, gzip: a.gzip + b.gzip })

export function parseAnalysis(text: string): Analysis {
  const v: unknown = JSON.parse(text)
  if (
    !record(v) ||
    !record(v.meta) ||
    v.meta.bundler !== 'rolldown' ||
    typeof v.meta.version !== 'string' ||
    !Array.isArray(v.modules) ||
    !v.modules.every((m) => record(m) && typeof m.path === 'string' && bytes(m.size)) ||
    !Array.isArray(v.chunks) ||
    !v.chunks.length
  )
    throw new Error('Invalid Rolldown analysis.')
  const moduleCount = v.modules.length
  const chunkCount = v.chunks.length
  for (const c of v.chunks as unknown[]) {
    if (
      !record(c) ||
      typeof c.name !== 'string' ||
      !bytes(c.size) ||
      !['static-entry', 'dynamic-entry', 'common'].includes(String(c.type)) ||
      (c.entryModule !== undefined && (!bytes(c.entryModule) || c.entryModule >= moduleCount)) ||
      (c.imports !== undefined &&
        (!Array.isArray(c.imports) ||
          !c.imports.every(
            (i) =>
              record(i) &&
              bytes(i.targetChunkIndex) &&
              i.targetChunkIndex < chunkCount &&
              ['static', 'dynamic'].includes(String(i.type)),
          )))
    )
      throw new Error('Invalid Rolldown chunk graph.')
  }
  return v as Analysis
}

export function staticClosure(analysis: Analysis, index: number): Set<number> {
  const seen = new Set<number>()
  const visit = (i: number) => {
    if (seen.has(i)) return
    seen.add(i)
    const chunk = analysis.chunks[i]
    if (!chunk) throw new Error(`Missing chunk ${i}`)
    for (const edge of chunk.imports ?? []) if (edge.type === 'static') visit(edge.targetChunkIndex)
  }
  visit(index)
  return seen
}

export async function collect(appDirectory: string, commit: string): Promise<Snapshot> {
  if (!/^[\da-f]{40}$/.test(commit)) throw new Error('Expected a commit SHA.')
  const app = resolve(appDirectory)
  const client = join(app, 'dist/client')
  const analysis = parseAnalysis(await readFile(join(client, 'bundle-analysis.json'), 'utf8'))
  const cache = new Map<string, Size>()
  const measure = async (file: string) => {
    const absolute = resolve(client, file)
    const local = relative(client, absolute)
    if (local.startsWith('..') || isAbsolute(local)) throw new Error('Asset outside client output.')
    const cached = cache.get(absolute)
    if (cached) return cached
    const data = await readFile(absolute)
    const result = { raw: data.length, gzip: gzipSync(data).length }
    cache.set(absolute, result)
    return result
  }
  const sumFiles = async (files: Iterable<string>) => {
    let result = empty()
    for (const file of new Set(files)) result = add(result, await measure(file))
    return result
  }
  const css: string[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name)
      if (item.isDirectory()) await visit(path)
      else if (item.isFile() && item.name.endsWith('.css')) css.push(path)
    }
  }
  await visit(join(client, '_next/static'))
  const entries: Record<string, Size> = Object.create(null)
  for (const [index, chunk] of analysis.chunks.entries()) {
    if (chunk.entryModule === undefined || chunk.type === 'common') continue
    const source = analysis.modules[chunk.entryModule]!.path
    // Application and virtual browser entries are stable across chunk hash changes.
    if (!source.startsWith('app/') && !source.includes('virtual:vinext-app-browser-entry')) continue
    const key = `${chunk.type}: ${source}`
    if (Object.hasOwn(entries, key)) throw new Error(`Duplicate entry: ${key}`)
    entries[key] = await sumFiles(
      [...staticClosure(analysis, index)].map((i) => analysis.chunks[i]!.name),
    )
  }
  if (!Object.keys(entries).length) throw new Error('No application entries in Rolldown analysis.')
  const packages: Record<string, number> = Object.create(null)
  for (const module of analysis.modules) {
    const tail = module.path.split('node_modules/').at(-1)!
    if (tail === module.path) continue
    const parts = tail.split('/')
    const name = tail.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
    packages[name] = (packages[name] ?? 0) + module.size
  }
  const pkg: unknown = JSON.parse(
    await readFile(join(app, 'node_modules/vinext/package.json'), 'utf8'),
  )
  if (!record(pkg) || typeof pkg.version !== 'string') throw new Error('Missing Vinext version.')
  return {
    version: 1,
    commit,
    vinext: pkg.version,
    rolldown: analysis.meta.version,
    totals: { js: await sumFiles(analysis.chunks.map((c) => c.name)), css: await sumFiles(css) },
    entries,
    packages,
  }
}

export function parseSnapshot(text: string): Snapshot {
  const v: unknown = JSON.parse(text)
  if (
    !record(v) ||
    v.version !== 1 ||
    typeof v.commit !== 'string' ||
    !/^[\da-f]{40}$/.test(v.commit) ||
    typeof v.vinext !== 'string' ||
    typeof v.rolldown !== 'string' ||
    !record(v.totals) ||
    !size(v.totals.js) ||
    !size(v.totals.css) ||
    !record(v.entries) ||
    !Object.keys(v.entries).length ||
    !Object.values(v.entries).every(size) ||
    !record(v.packages) ||
    !Object.values(v.packages).every(bytes)
  )
    throw new Error('Invalid bundle snapshot.')
  return v as Snapshot
}
const kib = (n: number) => `${(n / 1024).toFixed(2)} KiB`
export function shouldComment(a: Snapshot, b: Snapshot): boolean {
  return (
    Math.abs(b.totals.js.gzip - a.totals.js.gzip) >= 5 * 1024 ||
    Math.abs(b.totals.css.gzip - a.totals.css.gzip) >= 1024 ||
    Object.keys(a.entries).some(
      (key) => b.entries[key] && Math.abs(b.entries[key].gzip - a.entries[key]!.gzip) >= 2 * 1024,
    )
  )
}
const delta = (a: number, b: number) => {
  if (a === b) return '⚪ No change'
  const change = b - a
  const sign = change > 0 ? '+' : '−'
  const magnitude = Math.abs(change)
  const amount = magnitude < 1024 ? `${magnitude} B` : kib(magnitude)
  const ratio = a === 0 ? null : (magnitude / a) * 100
  const percent =
    ratio === null ? 'from zero' : `${sign}${ratio < 0.01 ? '<0.01' : ratio.toFixed(2)}%`
  return `${change > 0 ? '🟠' : '🟢'} **${sign}${amount} (${percent})**`
}
const details = (summary: string, rows: string[]) => [
  '<details>',
  `<summary>${summary}</summary>`,
  '',
  ...rows,
  '',
  '</details>',
]
const label = (s: string) =>
  `<code>${s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;').replaceAll('\n', ' ')}</code>`
export function compare(a: Snapshot, b: Snapshot): string {
  const lines = [
    '<!-- dify-vinext-bundle-size -->',
    '## Vinext bundle analysis',
    '',
    `**JS gzip:** ${delta(a.totals.js.gzip, b.totals.js.gzip)} · **CSS gzip:** ${delta(a.totals.css.gzip, b.totals.css.gzip)}`,
    '',
    '| All client output | Base gzip → Merge gzip | Gzip change |',
    '| --- | ---: | ---: |',
  ]
  for (const kind of ['js', 'css'] as const)
    lines.push(
      `| ${kind.toUpperCase()} | ${kib(a.totals[kind].gzip)} → ${kib(b.totals[kind].gzip)} | ${delta(a.totals[kind].gzip, b.totals[kind].gzip)} |`,
    )
  const changed = [...new Set([...Object.keys(a.entries), ...Object.keys(b.entries)])]
    .filter(
      (k) =>
        a.entries[k] &&
        b.entries[k] &&
        (a.entries[k].gzip !== b.entries[k].gzip || a.entries[k].raw !== b.entries[k].raw),
    )
    .sort(
      (x, y) =>
        Math.abs((b.entries[y]?.gzip ?? 0) - (a.entries[y]?.gzip ?? 0)) -
          Math.abs((b.entries[x]?.gzip ?? 0) - (a.entries[x]?.gzip ?? 0)) || x.localeCompare(y),
    )
  const increased = changed.filter((k) => b.entries[k]!.gzip > a.entries[k]!.gzip).length
  const decreased = changed.filter((k) => b.entries[k]!.gzip < a.entries[k]!.gzip).length
  const rawOnly = changed.length - increased - decreased
  lines.push(
    '',
    `**Entry changes:** 🟠 ${increased} increased · 🟢 ${decreased} decreased${rawOnly ? ` · ⚪ ${rawOnly} raw-only changes` : ''} (gzip).`,
    '',
    '### Largest entry changes',
    '',
    `Top ${Math.min(5, changed.length)} by absolute gzip delta. Static dependencies overlap; do not sum entries.`,
    '',
  )
  const entryTable = (keys: string[], full = false) => [
    `| Source entry | Base gzip → Merge gzip | Gzip change |${full ? ' Raw change |' : ''}`,
    `| --- | ---: | ---: |${full ? ' ---: |' : ''}`,
    ...keys.map(
      (k) =>
        `| ${label(full ? k : k.replace(/^(?:static|dynamic)-entry: /, ''))} | ${kib(a.entries[k]!.gzip)} → ${kib(b.entries[k]!.gzip)} | ${delta(a.entries[k]!.gzip, b.entries[k]!.gzip)} |${full ? ` ${delta(a.entries[k]!.raw, b.entries[k]!.raw)} |` : ''}`,
    ),
  ]
  if (changed.length) {
    lines.push(...entryTable(changed.slice(0, 5)), '')
    lines.push(
      ...details(
        `Top ${Math.min(20, changed.length)} of ${changed.length} changed entries (full paths and raw sizes)`,
        entryTable(changed.slice(0, 20), true),
      ),
    )
  } else {
    lines.push('No entry size changes.')
  }
  const topology = [...new Set([...Object.keys(a.entries), ...Object.keys(b.entries)])]
    .filter((k) => !a.entries[k] || !b.entries[k])
    .sort()
  if (topology.length) {
    lines.push(
      '',
      '<details>',
      `<summary>🆕 / ➖ ${topology.length} added or removed entries</summary>`,
      '',
      `Showing ${Math.min(20, topology.length)} of ${topology.length}. Entry-boundary changes are not size deltas from zero.`,
      '',
      '| Source entry | Change | Static dependencies (gzip) |',
      '| --- | --- | ---: |',
    )
    for (const k of topology.slice(0, 20))
      lines.push(
        `| ${label(k)} | ${b.entries[k] ? '🆕 New entry' : '➖ Removed entry'} | ${kib((b.entries[k] ?? a.entries[k])!.gzip)} |`,
      )
    lines.push('', '</details>')
  }
  const packages = [...new Set([...Object.keys(a.packages), ...Object.keys(b.packages)])]
    .filter((k) => a.packages[k] !== b.packages[k])
    .sort(
      (x, y) =>
        Math.abs((b.packages[y] ?? 0) - (a.packages[y] ?? 0)) -
        Math.abs((b.packages[x] ?? 0) - (a.packages[x] ?? 0)),
    )
  lines.push(
    '',
    '<details>',
    `<summary>📦 ${packages.length} package attribution changes (uncompressed modules)</summary>`,
    '',
    `Showing ${Math.min(15, packages.length)} of ${packages.length}, ordered by absolute module-size delta.`,
    '',
    '| Package | Base | Merge | Δ |',
    '| --- | ---: | ---: | ---: |',
  )
  if (!packages.length) lines.push('| No package attribution changes | — | — | — |')
  for (const k of packages.slice(0, 15))
    lines.push(
      `| ${label(k)} | ${kib(a.packages[k] ?? 0)} | ${kib(b.packages[k] ?? 0)} | ${delta(a.packages[k] ?? 0, b.packages[k] ?? 0)} |`,
    )
  lines.push(
    '',
    '</details>',
    '',
    '<details>',
    '<summary>Measurement details and build revisions</summary>',
    '',
    `Base: \`${a.commit}\` · Merge: \`${b.commit}\``,
    `Vinext: ${a.vinext} → ${b.vinext}; Rolldown: ${a.rolldown} → ${b.rolldown}`,
    '',
    `Raw JS change: ${delta(a.totals.js.raw, b.totals.js.raw)} · Raw CSS change: ${delta(a.totals.css.raw, b.totals.css.raw)}`,
    '',
    '🟠 Increase · 🟢 Decrease · ⚪ Unchanged. Colors indicate direction, not a performance budget verdict. Percentages use the base size.',
    '',
    'Entries follow only static edges in the official Rolldown chunk graph, deduplicating shared files. Dynamic entries are measured when loaded; they are not page first-load metrics. Entry totals overlap and must not be summed.',
    'Package attribution sums module sizes reported by Rolldown, not compressed emitted bytes. Gzip totals are measured per emitted file. This is Vinext output, not Next.js/Turbopack output.',
    'Report only: increases do not fail this check. Missing or incompatible analysis data does.',
  )
  if (a.vinext !== b.vinext || a.rolldown !== b.rolldown)
    lines.push('', 'Compiler versions differ; changes may include compiler effects.')
  lines.push('', '</details>')
  return `${lines.join('\n')}\n`
}

async function instrument(app: string) {
  await rename(join(app, 'vite.config.ts'), join(app, 'vite.config.bundle-original.ts'))
  await writeFile(
    join(app, 'vite.config.ts'),
    `import { defineConfig, mergeConfig } from 'vite-plus'
import { bundleAnalyzerPlugin } from 'vite/rolldown/experimental'
import original from './vite.config.bundle-original.ts'
export default defineConfig(async env => mergeConfig(await (typeof original === 'function' ? original(env) : original), {
  plugins: [{ name: 'dify:bundle-analysis', applyToEnvironment(environment) {
    return environment.name === 'client' ? [
      bundleAnalyzerPlugin({ fileName: 'bundle-analysis.json' }),
      bundleAnalyzerPlugin({ fileName: 'bundle-analysis.md', format: 'md' }),
    ] : false
  } }],
}))
`,
  )
}
async function main() {
  const [command, first, second, output] = process.argv.slice(2)
  if (command === 'instrument' && first) return instrument(first)
  if (!first || !second || !output)
    throw new Error(
      'Usage: instrument <web> | collect <web> <sha> <json> | compare <base.json> <merge.json> <report.md>',
    )
  let result: string
  if (command === 'collect') {
    result = `${JSON.stringify(await collect(first, second), null, 2)}\n`
  } else if (command === 'compare') {
    const base = parseSnapshot(await readFile(first, 'utf8'))
    const merged = parseSnapshot(await readFile(second, 'utf8'))
    result = compare(base, merged)
    if (process.env.GITHUB_OUTPUT)
      await appendFile(process.env.GITHUB_OUTPUT, `should-comment=${shouldComment(base, merged)}\n`)
  } else {
    throw new Error('Unknown command.')
  }
  await mkdir(dirname(resolve(output)), { recursive: true })
  await writeFile(output, result)
}
if (import.meta.main)
  main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
