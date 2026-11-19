/* oxlint-disable vitest/no-import-node-test, antfu/no-import-dist -- Verify the loader's module graph and watch invalidation against the built package. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import loader from '../dist/tooling/loader.js'
/* oxlint-enable vitest/no-import-node-test, antfu/no-import-dist */

const root = resolve(import.meta.dirname, '..')

function runLoader(context) {
  return new Promise((resolve, reject) => {
    loader.call({
      getResolve: () => async () => {
        throw new Error('Unexpected re-export')
      },
      ...context,
      async: () => (error, source) => (error ? reject(error) : resolve(source)),
    })
  })
}

test('loader namespaces use a tiny resource and invalidate when the source document changes', async () => {
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
    const entry = await runLoader(context)
    const rootModule = JSON.parse(entry.match(/export \* from (.+);/)[1])
    const namespacePath = join(root, 'dist/tooling/openapi-namespace.js')
    const namespaceEntry = await runLoader({
      ...context,
      resourcePath: namespacePath,
      getOptions: () => ({}),
      resourceQuery: rootModule.slice(rootModule.indexOf('?')),
    })
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
      getOptions: () => ({}),
      resourceQuery: `?${query}`,
    }
    const before = await runLoader(namespaceContext)
    assert(before.includes('as "get"'))
    const runtimeImport = JSON.parse(before.match(/import runtime from (.+);/)[1])
    assert.equal(resolve(dirname(namespaceContext.resourcePath), runtimeImport), runtime)
    assert(dependencies.has(file))
    assert(dependencies.has(runtime))
    spec.paths['/pets'].delete = { responses: { 204: { description: 'Deleted' } } }
    writeFileSync(file, JSON.stringify(spec))
    const after = await runLoader(namespaceContext)
    assert(after.includes('as "delete"'))
    assert.notEqual(after, before)
    const errors = `${file}.errors.ts`
    writeFileSync(errors, 'const errors = {}; export { errors as "GET /pets" };')
    const configured = await runLoader(namespaceContext)
    assert(configured.includes('openapi-errors='))
    assert(dependencies.has(errors))
    const errorQuery = new URLSearchParams(query)
    errorQuery.delete('openapi-router')
    errorQuery.set('openapi-errors', JSON.stringify(['pets', 'get']))
    const errorModule = await runLoader({ ...namespaceContext, resourceQuery: `?${errorQuery}` })
    assert(errorModule.includes('"GET /pets" as errors'))
    const errorImport = JSON.parse(errorModule.match(/from (.+);/)[1])
    assert.equal(resolve(dirname(namespacePath), errorImport), errors)
    writeFileSync(errors, 'const errors = {}; export { errors as "DELETE /pets" };')
    const changed = await runLoader(namespaceContext)
    assert.notEqual(changed, configured)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('loader resolves logical sidecar re-exports and invalidates when their sources change', async () => {
  const directory = mkdtempSync(join(root, 'test/.loader-sidecars-'))
  const file = join(directory, 'physical.json')
  const logical = join(directory, 'logical.openapi')
  const namespacePath = join(root, 'dist/tooling/openapi-namespace.js')
  const dependencies = new Set()
  const resolutions = []
  const context = {
    resourcePath: namespacePath,
    resourceQuery: `?${new URLSearchParams({ 'openapi-document': file, 'openapi-query': JSON.stringify(['pets']) })}`,
    getOptions: () => ({ sidecars: './logical.openapi' }),
    addDependency: (file) => dependencies.add(file),
    getResolve: (options) => async (context, request) => {
      assert.deepEqual(options, { dependencyType: 'esm' })
      assert.equal(context, directory)
      resolutions.push(request)
      return resolve(context, request.replace(/\.js$/, '.ts'))
    },
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
    writeFileSync(`${logical}.queries.ts`, "export * from './defaults.js';")
    writeFileSync(
      join(directory, 'defaults.ts'),
      'const defaults = { queryOptions: { staleTime: 42 } }; export { defaults as "GET /pets" };',
    )
    writeFileSync(`${logical}.errors.ts`, "export * from './errors.js';")
    writeFileSync(
      join(directory, 'errors.ts'),
      'const errors = { CONFLICT: { status: 409 } }; export { errors as "GET /pets" };',
    )
    const [selected, concurrent] = await Promise.all([runLoader(context), runLoader(context)])
    assert.equal(concurrent, selected)
    assert.deepEqual(resolutions.sort(), ['./defaults.js', './errors.js'])
    assert(selected.includes('"GET /pets" as operation0Defaults'))
    assert(selected.includes('openapi-errors='))
    assert(dependencies.has(`${logical}.queries.ts`))
    assert(dependencies.has(`${logical}.errors.ts`))
    assert(dependencies.has(join(directory, 'defaults.ts')))
    assert(dependencies.has(join(directory, 'errors.ts')))
    writeFileSync(join(directory, 'errors.ts'), 'export {};')
    const changed = await runLoader(context)
    assert(!changed.includes('openapi-errors='))
    assert(changed.includes('"GET /pets" as operation0Defaults'))
    const withoutSidecars = await runLoader({ ...context, getOptions: () => ({}) })
    assert(!withoutSidecars.includes('operation0Defaults'))
    assert(!withoutSidecars.includes('openapi-errors='))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
