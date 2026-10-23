import type { Transform } from './transform.js'
import { createHash, randomUUID } from 'node:crypto'
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { record } from '../document.js'
import { runtimeConfigFile, transformSpec } from './transform.js'

const maxEntries = 64
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

function isTransform(value: unknown): value is Transform {
  const result = record(value)
  return (
    result.extension === '.ts' &&
    typeof result.text === 'string' &&
    result.diagnostics === undefined &&
    Array.isArray(result.mappings) &&
    result.mappings.every(
      (mapping) =>
        Array.isArray(mapping) &&
        mapping.length === 6 &&
        (mapping[4] === 0 || mapping[4] === 1) &&
        mapping.every((part) => Number.isSafeInteger(part) && part >= 0),
    )
  )
}

/** One slot per document, bounded across projects; cache failures never break compilation. */
export function createCachedTransform(
  directory: string,
  revision: string,
  transform = transformSpec,
) {
  return (content: string, fileName: string): Transform => {
    // The generated text imports Context by path. Its contents are checked by TS;
    // adding/removing the sidecar changes the generated import itself.
    const key = digest(JSON.stringify([revision, fileName, runtimeConfigFile(fileName), content]))
    const file = join(directory, `${digest(fileName)}.json`)
    try {
      const entry = record(JSON.parse(readFileSync(file, 'utf8')))
      if (
        entry.key === key &&
        isTransform(entry.result) &&
        entry.checksum === digest(JSON.stringify(entry.result))
      )
        return entry.result
    } catch {
      // Missing, corrupt or inaccessible caches are equivalent to a cache miss.
    }
    const result = transform(content, fileName)
    if (result.diagnostics) return result
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      const checksum = digest(JSON.stringify(result))
      writeFileSync(temporary, JSON.stringify({ key, checksum, result }), {
        mode: 0o600,
        flag: 'wx',
      })
      renameSync(temporary, file)
      const entries = readdirSync(directory).filter((name) => /^[a-f\d]{64}\.json$/.test(name))
      if (entries.length > maxEntries) {
        const oldest = entries
          .map((name) => ({ name, time: statSync(join(directory, name)).mtimeMs }))
          .sort((a, b) => a.time - b.time)
        for (const entry of oldest.slice(0, entries.length - maxEntries))
          rmSync(join(directory, entry.name), { force: true })
      }
    } catch {
      // The cache is an optimization, including on read-only filesystems.
    } finally {
      try {
        rmSync(temporary, { force: true })
      } catch {
        // Another process or filesystem policy may prevent cleanup.
      }
    }
    return result
  }
}

export function mapperTransform() {
  // Hash the implementation, not just the published version: workspace rebuilds
  // must invalidate cached output even when the package version stays unchanged.
  const files = [
    'mapper-cache.js',
    'transform.js',
    'schema-types.js',
    'router.js',
    '../document.js',
    '../operation.js',
  ]
  const parser = readFileSync(createRequire(import.meta.url).resolve('yaml/package.json'), 'utf8')
  const revision = digest(
    [...files.map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')), parser].join(
      '\0',
    ),
  )
  const owner = process.getuid?.() ?? process.env.USERNAME ?? 'user'
  return createCachedTransform(join(tmpdir(), `dify-openapi-inference-${owner}`), revision)
}
