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
    const apiModule = JSON.parse(entry.match(/export \* as api from (.+);/)[1])
    assert.equal(
      resolve(dirname(file), apiModule.split('?')[0]),
      join(root, 'dist/tooling/openapi-namespace.js'),
    )
    const query = new URLSearchParams(apiModule.slice(apiModule.indexOf('?')))
    assert.equal(query.get('openapi-document'), file)
    assert.equal(query.get('openapi-router'), '[]')
    query.set('openapi-router', JSON.stringify(['pets']))
    const namespaceContext = {
      ...context,
      resourcePath: join(root, 'dist/tooling/openapi-namespace.js'),
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
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
