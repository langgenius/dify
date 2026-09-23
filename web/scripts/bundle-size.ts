import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

type Size = { raw: number; gzip: number }
type Snapshot = {
  version: 1
  commit: string
  nextVersion: string
  totals: { js: Size; css: Size }
  routes: Record<string, Size>
}

const emptySize = (): Size => ({ raw: 0, gzip: 0 })
const addSize = (a: Size, b: Size): Size => ({ raw: a.raw + b.raw, gzip: a.gzip + b.gzip })
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isSize = (value: unknown): value is Size =>
  isRecord(value) &&
  [value.raw, value.gzip].every((size) => Number.isSafeInteger(size) && Number(size) >= 0)

export async function collectSnapshot(appDirectory: string, commit: string): Promise<Snapshot> {
  const appRoot = resolve(appDirectory)
  const dist = join(appRoot, '.next')
  const stats: unknown = JSON.parse(
    await readFile(join(dist, 'diagnostics/route-bundle-stats.json'), 'utf8'),
  )
  if (!Array.isArray(stats) || !stats.length)
    throw new Error('Next route-bundle-stats.json must contain at least one route.')

  const sizes = new Map<string, Size>()
  const measure = async (file: string) => {
    const absolute = resolve(appRoot, file)
    const pathInBuild = relative(dist, absolute)
    if (pathInBuild.startsWith('..') || isAbsolute(pathInBuild))
      throw new Error(`Chunk path is outside .next: ${file}`)
    const cached = sizes.get(absolute)
    if (cached) return cached
    // Missing chunks must fail the report instead of silently appearing as savings.
    const contents = await readFile(absolute)
    const size = { raw: contents.length, gzip: gzipSync(contents).length }
    sizes.set(absolute, size)
    return size
  }

  const routes: Record<string, Size> = Object.create(null)
  for (const row of stats as unknown[]) {
    if (
      !isRecord(row) ||
      typeof row.route !== 'string' ||
      !row.route.startsWith('/') ||
      !Array.isArray(row.firstLoadChunkPaths) ||
      !row.firstLoadChunkPaths.length ||
      !row.firstLoadChunkPaths.every(
        (file: unknown) => typeof file === 'string' && file.endsWith('.js'),
      )
    )
      throw new Error('Unsupported Next route bundle stats format.')
    if (Object.hasOwn(routes, row.route)) throw new Error(`Duplicate route: ${row.route}`)
    let size = emptySize()
    for (const file of new Set(row.firstLoadChunkPaths as string[]))
      size = addSize(size, await measure(file))
    routes[row.route] = size
  }

  const totals = { js: emptySize(), css: emptySize() }
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) await visit(file)
      else if (entry.isFile()) {
        const kind = entry.name.endsWith('.js') ? 'js' : entry.name.endsWith('.css') ? 'css' : null
        if (kind) totals[kind] = addSize(totals[kind], await measure(file))
      }
    }
  }
  await visit(join(dist, 'static/chunks'))
  const nextPackage: unknown = JSON.parse(
    await readFile(join(appRoot, 'node_modules/next/package.json'), 'utf8'),
  )
  if (!isRecord(nextPackage) || typeof nextPackage.version !== 'string')
    throw new Error('Cannot determine the installed Next.js version.')
  return { version: 1, commit, nextVersion: nextPackage.version, totals, routes }
}

export function parseSnapshot(text: string): Snapshot {
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.commit !== 'string' ||
    !/^[\da-f]{40}$/.test(value.commit) ||
    typeof value.nextVersion !== 'string' ||
    !isRecord(value.totals) ||
    !isSize(value.totals.js) ||
    !isSize(value.totals.css) ||
    !isRecord(value.routes) ||
    !Object.keys(value.routes).length ||
    !Object.entries(value.routes).every(([route, size]) => route.startsWith('/') && isSize(size))
  )
    throw new Error('Invalid bundle-size snapshot.')
  return value as Snapshot
}

const formatSize = (bytes: number) => `${(bytes / 1024).toFixed(2)} KiB`
const delta = (base: number, head: number) => {
  const change = head - base
  return `${change > 0 ? '+' : change < 0 ? '−' : ''}${formatSize(Math.abs(change))}`
}
const routeLabel = (route: string) =>
  `<code>${route.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;').replaceAll('\n', ' ')}</code>`

export function compareSnapshots(base: Snapshot, head: Snapshot): string {
  const lines = [
    '<!-- dify-web-bundle-size -->',
    '## Web bundle size',
    '',
    `Base: \`${base.commit}\` · Compared: \`${head.commit}\``,
    `Next.js: \`${base.nextVersion}\` → \`${head.nextVersion}\``,
    '',
    '### All emitted client chunks (including async)',
    '',
    '| Type | Base raw | Head raw | Raw Δ | Gzip Δ |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...(['js', 'css'] as const).map((kind) => {
      const a = base.totals[kind]
      const b = head.totals[kind]
      return `| ${kind.toUpperCase()} | ${formatSize(a.raw)} | ${formatSize(b.raw)} | ${delta(a.raw, b.raw)} | ${delta(a.gzip, b.gzip)} |`
    }),
    '',
    '### Route initial JavaScript',
    '',
  ]
  const changed = [...new Set([...Object.keys(base.routes), ...Object.keys(head.routes)])]
    .filter((route) => {
      const a = base.routes[route]
      const b = head.routes[route]
      return !a || !b || a.raw !== b.raw || a.gzip !== b.gzip
    })
    .sort(
      (a, b) =>
        Math.abs((head.routes[b]?.gzip ?? 0) - (base.routes[b]?.gzip ?? 0)) -
          Math.abs((head.routes[a]?.gzip ?? 0) - (base.routes[a]?.gzip ?? 0)) || a.localeCompare(b),
    )
  if (!changed.length) lines.push('No route size changes.')
  else {
    lines.push(
      `Showing ${Math.min(20, changed.length)} of ${changed.length} changed routes, ordered by absolute gzip delta.`,
      '',
      '| Route | Base gzip | Head gzip | Gzip Δ | Raw Δ |',
      '| --- | ---: | ---: | ---: | ---: |',
    )
    for (const route of changed.slice(0, 20)) {
      const a = base.routes[route]
      const b = head.routes[route]
      lines.push(
        `| ${routeLabel(route)} | ${a ? formatSize(a.gzip) : 'New'} | ${b ? formatSize(b.gzip) : 'Removed'} | ${delta(a?.gzip ?? 0, b?.gzip ?? 0)} | ${delta(a?.raw ?? 0, b?.raw ?? 0)} |`,
      )
    }
  }
  lines.push(
    '',
    'Route sizes use Next.js firstLoadChunkPaths, including shared layout/runtime chunks once per route. Do not sum routes: their chunks overlap.',
    'Gzip is computed per emitted file. These are build metrics, not measured network transfer or page-load timings. Total chunks include lazy assets; route initial JS does not include every lazy asset.',
    'Report only: size increases do not fail this check. Missing or invalid build data does.',
  )
  if (base.nextVersion !== head.nextVersion)
    lines.push('', 'Next.js versions differ; compiler changes can affect this comparison.')
  return `${lines.join('\n')}\n`
}

async function main() {
  const [command, first, second, third] = process.argv.slice(2)
  if (!first || !second || !third || !['collect', 'compare'].includes(command ?? ''))
    throw new Error(
      'Usage: bundle-size.ts collect <web-dir> <commit> <output.json> | compare <base.json> <head.json> <output.md>',
    )
  const output =
    command === 'collect'
      ? `${JSON.stringify(await collectSnapshot(first, second), null, 2)}\n`
      : compareSnapshots(
          parseSnapshot(await readFile(first, 'utf8')),
          parseSnapshot(await readFile(second, 'utf8')),
        )
  await mkdir(dirname(resolve(third)), { recursive: true })
  await writeFile(third, output)
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
