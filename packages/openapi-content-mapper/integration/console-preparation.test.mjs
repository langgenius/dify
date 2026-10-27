/* oxlint-disable vitest/no-import-node-test, antfu/no-import-dist -- Verify the composed migration surface against the existing public contract. */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { test } from 'node:test'
import { consoleRouterContract } from '../../contracts/console.ts'
import {
  composeConsoleDocuments,
  loadConsoleDocument,
} from '../../contracts/scripts/compose-console-openapi.mjs'
import { describeOperations } from '../dist/operation.js'
import { createRouter } from '../dist/tooling/router.js'
/* oxlint-enable vitest/no-import-node-test, antfu/no-import-dist */

const files = [
  'console-openapi.json',
  'fastopenapi-console-openapi.json',
  'console-client-openapi.json',
].map((name) => new URL(`../../contracts/openapi/${name}`, import.meta.url))

test('every existing Console member retains its name, HTTP method and route', (t) => {
  const before = files.map((file) => existsSync(file))
  const document = loadConsoleDocument()
  assert.deepEqual(loadConsoleDocument(), document, 'In-memory composition must be deterministic')
  assert.deepEqual(
    files.map((file) => existsSync(file)),
    before,
    'Export must not create OpenAPI files',
  )
  const operations = describeOperations(document)
  const router = createRouter(operations)
  const visited = new Set()
  function walk(node, path = []) {
    const definition = node['~orpc']
    if (!definition) {
      for (const [key, child] of Object.entries(node)) walk(child, [...path, key])
      return
    }
    let current = router
    for (const member of path.slice(0, -1)) current = current?.children.get(member)
    const operation = current?.methods.get(path.at(-1))
    assert(operation, `Missing client member: ${path.join('.')}`)
    assert.equal(operation.path, definition.route.path, path.join('.'))
    assert.equal(operation.method.toUpperCase(), definition.route.method, path.join('.'))
    assert(!visited.has(operation), `Two members resolve to the same operation: ${path.join('.')}`)
    visited.add(operation)
  }
  walk(consoleRouterContract)
  assert.equal(
    visited.size,
    operations.size,
    'The composed client must not introduce unmatched operations',
  )
  t.diagnostic(
    `${visited.size} Console operations, including Enterprise, App Deploy and FastOpenAPI`,
  )
})

test('composition isolates schemas and rejects ambiguous routes and external references', () => {
  const source = (path, type) => ({
    openapi: '3.1.0',
    paths: {
      [path]: {
        get: {
          responses: {
            200: {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Value' } } },
            },
          },
        },
      },
    },
    components: { schemas: { Value: { type } } },
  })
  const composed = composeConsoleDocuments([
    { name: 'a', document: source('/a', 'string') },
    { name: 'b', document: source('/b', 'number') },
  ])
  assert.equal(composed.components.schemas.a_Value.type, 'string')
  assert.equal(
    composed.paths['/b'].get.responses[200].content['application/json'].schema.$ref,
    '#/components/schemas/b_Value',
  )
  assert.throws(
    () =>
      composeConsoleDocuments([
        { name: 'a', document: source('/a', 'string') },
        { name: 'b', document: source('/a', 'number') },
      ]),
    /Duplicate Console path/,
  )
  const external = source('/a', 'string')
  external.components.schemas.Value = { $ref: 'external.json#/Value' }
  assert.throws(
    () => composeConsoleDocuments([{ name: 'a', document: external }]),
    /Unsupported reference/,
  )
})
