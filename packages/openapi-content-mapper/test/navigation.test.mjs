/* oxlint-disable vitest/no-import-node-test, antfu/no-import-dist -- Native integration with the built mapper and editor navigation adapter. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compileRuntime, transformSpec } from '../dist/tooling/transform.js'
import { backendLocations } from '../vscode/locations.cjs'
/* oxlint-enable vitest/no-import-node-test, antfu/no-import-dist */

test('backend links survive Markdown-sensitive filenames without entering runtime modules', () => {
  const spec = JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'navigation', version: '1' },
    paths: {
      '/pets': {
        get: {
          'x-source-location': { file: './back end(1)*/handler.py', line: 12 },
          responses: { 204: { description: 'OK' } },
        },
      },
    },
  })
  const result = transformSpec(spec, '/project/spec.openapi')
  assert.equal(result.diagnostics, undefined)
  assert.deepEqual(backendLocations([{ value: result.text }]), [
    {
      uri: 'file:///project/back%20end%281%29%2A/handler.py',
      line: 12,
    },
  ])
  assert.doesNotMatch(
    compileRuntime(spec, '/project/spec.openapi')(['pets']),
    /handler.py|x-source-location|Open backend/,
  )
})

test('navigation ignores missing, malformed, unrelated and non-file links and deduplicates origins', () => {
  const link = '[Open backend implementation](file:///project/backend.py#L9)'
  assert.deepEqual(
    backendLocations([
      { value: `${link}\n${link}` },
      '[Unrelated](file:///project/other.py#L9)',
      '[Open backend implementation](https://example.com/backend.py#L9)',
      '[Open backend implementation](file:///project/backend.py#L0)',
      '[Open backend implementation](file:///project/backend.py#L99999999999999999)',
      '[Open backend implementation](file:///project/backend.py?query=x#L9)',
      'ordinary hover without metadata',
    ]),
    [{ uri: 'file:///project/backend.py', line: 9 }],
  )
})
