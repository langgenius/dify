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
import { operationConfigFile, runtimeConfigFile } from './runtime-config.js'

const maxEntries = 64
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

/** One slot per document, bounded across projects; cache failures never break compilation. */
export function createCachedTransform(
  directory: string,
  revision: string,
  transform: (content: string, fileName: string) => Transform | Promise<Transform> = async (
    content,
    fileName,
  ) => (await import('./transform.js')).transformSpec(content, fileName),
) {
  return async (content: string, fileName: string): Promise<string> => {
    // Sidecar contents are checked by TS; its presence changes the generated import.
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          revision,
          fileName,
          runtimeConfigFile(fileName),
          operationConfigFile(fileName, 'errors'),
        ]),
      )
      .update('\n')
      .update(content)
      .digest('hex')
    const file = join(directory, `${digest(fileName)}.cache`)
    try {
      // Store the already serialized result. A checksum over these exact bytes
      // avoids parsing and rebuilding every source mapping on each compiler run.
      const entry = readFileSync(file, 'utf8')
      const serialized = entry.slice(130)
      if (
        entry.slice(0, 65) === `${key}\n` &&
        entry[129] === '\n' &&
        entry.slice(65, 129) === digest(serialized)
      )
        return serialized
    } catch {
      // Missing, corrupt or inaccessible caches are equivalent to a cache miss.
    }
    const result = await transform(content, fileName)
    const serialized = JSON.stringify(result)
    if (result.diagnostics) return serialized
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      const checksum = digest(serialized)
      writeFileSync(temporary, `${key}\n${checksum}\n${serialized}`, {
        mode: 0o600,
        flag: 'wx',
      })
      renameSync(temporary, file)
      const entries = readdirSync(directory).filter((name) =>
        /^[a-f\d]{64}\.(?:cache|json)$/.test(name),
      )
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
    return serialized
  }
}

export function mapperTransform() {
  // Hash the implementation, not just the published version: workspace rebuilds
  // must invalidate cached output even when the package version stays unchanged.
  const files = [
    'mapper-cache.js',
    'transform.js',
    'source.js',
    'runtime-config.js',
    'operation-config.js',
    'type-document.js',
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
  return createCachedTransform(join(tmpdir(), `dify-openapi-content-mapper-${owner}`), revision)
}
