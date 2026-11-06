import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@hey-api/openapi-ts'
import {
  cloneDocumentWithPaths,
  createApiConfig,
  normalizeApiSwagger,
  orpcErrorMaps,
} from '../openapi-ts.api.config.ts'
import { getTypedEventStreamOperations } from './api-contract-streaming-utils.mjs'

// Refresh only the Builder owner through the ordinary API contract plugins.
// The shared config still needs the ignored OpenAPI inputs prepared first, as
// documented by the lifecycle compatibility generator.
const packageRoot = resolve(import.meta.dirname, '..')
const consoleDocument = normalizeApiSwagger(
  JSON.parse(
    execFileSync('uv', ['run', '--project', 'api', 'api/dev/cached_console_openapi.py'], {
      cwd: resolve(packageRoot, '../..'),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 100000,
    }),
  ).console,
)
const paths = Object.fromEntries(
  Object.entries(consoleDocument.paths ?? {}).filter(([route]) =>
    route.startsWith('/dify-builder/'),
  ),
)
assert(Object.keys(paths).length > 0, 'Missing Builder Console operations')
const document = cloneDocumentWithPaths(consoleDocument, paths)
// This owner currently documents generic error bodies. Fail if it gains named
// errors rather than silently skipping the ordinary error-map postprocessor.
assert.equal(
  orpcErrorMaps(document).size,
  0,
  'Builder named errors need scoped error-map generation',
)
const outputPath = resolve(packageRoot, 'generated/api/console/dify-builder')
await createClient(createApiConfig({ document, outputPath }))

// The normal API pipeline wraps typed SSE outputs after generation. Scope that
// same transformation to this fresh owner so retained contracts are untouched.
const operations = getTypedEventStreamOperations(document)
if (operations.length > 0) {
  const orpcPath = resolve(outputPath, 'orpc.gen.ts')
  let source = replaceOnce(
    readFileSync(orpcPath, 'utf8'),
    "import { oc } from '@orpc/contract'",
    "import { eventIterator, oc } from '@orpc/contract'",
  )
  for (const operation of operations) {
    const responseSchema = `z${operation.operationId.charAt(0).toUpperCase()}${operation.operationId.slice(1)}Response`
    source = replaceOnce(
      source,
      `.output(${responseSchema})`,
      `.output(eventIterator(${responseSchema}))`,
    )
  }
  writeFileSync(orpcPath, source)
}
execFileSync('pnpm', ['exec', 'vp', 'fmt', outputPath], { cwd: packageRoot, stdio: 'inherit' })

function replaceOnce(source: string, target: string, replacement: string) {
  const firstIndex = source.indexOf(target)
  assert(
    firstIndex !== -1 && source.indexOf(target, firstIndex + target.length) === -1,
    `Expected exactly one generated occurrence of ${target}`,
  )
  return source.slice(0, firstIndex) + replacement + source.slice(firstIndex + target.length)
}
