import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createClient } from '@hey-api/openapi-ts'
import {
  cloneDocumentWithPaths,
  createApiConfig,
  normalizeApiSwagger,
} from '../openapi-ts.api.config.ts'

// Preserve the frozen legacy Console contracts; snapshot only the three new
// Builder lifecycle operations with the same normalizer and generator plugins.
const packageRoot = resolve(import.meta.dirname, '..')
const document = normalizeApiSwagger(
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
  [
    '/dify-builder/sessions/{session_id}/abandon',
    '/dify-builder/sessions/{session_id}/clear',
    '/dify-builder/sessions/{session_id}/fix-intents',
  ].map((route) => {
    const item = document.paths?.[route]
    if (!item?.post) throw new Error(`Missing lifecycle operation: ${route}`)
    if (
      ['get', 'put', 'patch', 'delete', 'head', 'options', 'trace'].some((method) => item[method])
    )
      throw new Error(`Unexpected lifecycle method: ${route}`)
    // Path-item parameters (including required session_id) apply to the POST.
    return [route, item]
  }),
)
const outputPath = resolve(packageRoot, 'fixtures/builder-lifecycle')
const config = createApiConfig({ document: cloneDocumentWithPaths(document, paths), outputPath })
// The audit consumes oRPC's inferred Zod input/output types, not a separate SDK.
await createClient({
  ...config,
  plugins: config.plugins?.filter(
    (plugin) => typeof plugin !== 'object' || plugin.name !== '@hey-api/typescript',
  ),
})
execFileSync('pnpm', ['exec', 'vp', 'fmt', outputPath], { cwd: packageRoot, stdio: 'inherit' })
