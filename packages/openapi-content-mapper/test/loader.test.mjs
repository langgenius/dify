/* oxlint-disable vitest/no-import-node-test, antfu/no-import-dist -- Verify the loader's module graph and watch invalidation against the built package. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import loader from '../dist/tooling/loader.js'
/* oxlint-enable vitest/no-import-node-test, antfu/no-import-dist */

const root = resolve(import.meta.dirname, '..')

test('loader namespaces use a tiny resource and invalidate when the source document changes', () => {
  const directory = mkdtempSync(join(root, 'test/.loader-&-'))
  const file = join(directory, 'spec.json')
  const runtime = join(directory, 'runtime.js')
  const dependencies = new Set()
  const spec = {
    openapi: '3.1.0',
    info: { title: 'Loader', version: '1' },
    paths: { '/pets': { get: { responses: { 200: { description: 'OK' } } } } },
  }
  const context = {
    resourcePath: file,
    resourceQuery: '',
    getOptions: () => ({ runtime: './runtime.js' }),
    addDependency: (file) => dependencies.add(file),
  }
  try {
    writeFileSync(file, JSON.stringify(spec))
    writeFileSync(runtime, 'export default {};')
    const entry = loader.call(context, JSON.stringify(spec))
    const rootModule = JSON.parse(entry.match(/export \* from (.+);/)[1])
    const namespacePath = join(root, 'dist/tooling/openapi-namespace.js')
    const namespaceEntry = loader.call(
      {
        ...context,
        resourcePath: namespacePath,
        resourceQuery: rootModule.slice(rootModule.indexOf('?')),
      },
      '',
    )
    const apiModule = JSON.parse(namespaceEntry.match(/export \* as api from (.+);/)[1])
    assert.equal(
      resolve(dirname(namespacePath), apiModule.split('?')[0]),
      join(root, 'dist/tooling/openapi-namespace.js'),
    )
    const query = new URLSearchParams(apiModule.slice(apiModule.indexOf('?')))
    assert.equal(query.get('openapi-document'), file)
    assert.equal(query.get('openapi-router'), '[]')
    query.set('openapi-router', JSON.stringify(['pets']))
    const namespaceContext = {
      ...context,
      resourcePath: namespacePath,
      resourceQuery: `?${query}`,
    }
    const before = loader.call(namespaceContext, '')
    assert(before.includes('as "get"'))
    const runtimeImport = JSON.parse(before.match(/import runtime from (.+);/)[1])
    assert.equal(resolve(dirname(namespaceContext.resourcePath), runtimeImport), runtime)
    assert(dependencies.has(file))
    assert(dependencies.has(runtime))
    spec.paths['/pets'].delete = { responses: { 204: { description: 'Deleted' } } }
    writeFileSync(file, JSON.stringify(spec))
    const after = loader.call(namespaceContext, '')
    assert(after.includes('as "delete"'))
    assert.notEqual(after, before)
    const errors = `${file}.errors.ts`
    writeFileSync(errors, 'const errors = {}; export { errors as "GET /pets" };')
    const configured = loader.call(namespaceContext, '')
    assert(configured.includes('openapi-errors='))
    assert(dependencies.has(errors))
    const errorQuery = new URLSearchParams(query)
    errorQuery.delete('openapi-router')
    errorQuery.set('openapi-errors', JSON.stringify(['pets', 'get']))
    const errorModule = loader.call({ ...namespaceContext, resourceQuery: `?${errorQuery}` }, '')
    assert(errorModule.includes('"GET /pets" as errors'))
    const errorImport = JSON.parse(errorModule.match(/from (.+);/)[1])
    assert.equal(resolve(dirname(namespacePath), errorImport), errors)
    writeFileSync(errors, 'const errors = {}; export { errors as "DELETE /pets" };')
    const changed = loader.call(namespaceContext, '')
    assert.notEqual(changed, configured)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('loader binds logical sidecars when the document resolves outside the application', () => {
  const directory = mkdtempSync(join(root, 'test/.loader-sidecars-'))
  const file = join(directory, 'physical.json')
  const logical = join(directory, 'logical.openapi')
  const namespacePath = join(root, 'dist/tooling/openapi-namespace.js')
  const dependencies = new Set()
  const context = {
    resourcePath: namespacePath,
    resourceQuery: `?${new URLSearchParams({ 'openapi-document': file, 'openapi-query': JSON.stringify(['pets']) })}`,
    getOptions: () => ({ sidecars: './logical.openapi' }),
    addDependency: (file) => dependencies.add(file),
  }
  try {
    writeFileSync(
      file,
      JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'Logical sidecars', version: '1' },
        paths: { '/pets': { get: { responses: { 200: { description: 'OK' } } } } },
      }),
    )
    writeFileSync(
      `${logical}.queries.ts`,
      'const defaults = { queryOptions: { staleTime: 42 } }; export { defaults as "GET /pets" };',
    )
    writeFileSync(
      `${logical}.errors.ts`,
      'const errors = { CONFLICT: { status: 409 } }; export { errors as "GET /pets" };',
    )
    const selected = loader.call(context)
    assert(selected.includes('"GET /pets" as operation0Defaults'))
    assert(selected.includes('openapi-errors='))
    assert(dependencies.has(`${logical}.queries.ts`))
    assert(dependencies.has(`${logical}.errors.ts`))
    const withoutSidecars = loader.call({ ...context, getOptions: () => ({}) })
    assert(!withoutSidecars.includes('operation0Defaults'))
    assert(!withoutSidecars.includes('openapi-errors='))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
