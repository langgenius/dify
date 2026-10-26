/* oxlint-disable vitest/no-import-node-test, antfu/no-import-dist -- Compare projected and full virtual documents with the native compiler. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { transformSpec } from '../dist/tooling/transform.js'
/* oxlint-enable vitest/no-import-node-test, antfu/no-import-dist */

const root = resolve(import.meta.dirname, '..')
test('projection preserves structural refs, escaped pointers, literal payloads and binary media types', () => {
  const spec = {
    openapi: '3.1.0',
    info: { title: 'not a type', version: '1' },
    paths: { '/pets': { $ref: '#/components/schemas/Path' } },
    components: {
      schemas: {
        Path: {
          parameters: [{ $ref: '#/extra/1' }],
          get: { $ref: '#/operations/get' },
          post: {
            requestBody: { $ref: '#/bodies/input' },
            responses: { 201: { $ref: '#/responses/pet' } },
          },
        },
        'Pet/~': {
          type: 'object',
          required: ['name', 'file', 'next', 'literal'],
          properties: {
            name: { type: 'string' },
            file: { type: 'string', format: 'binary' },
            next: { anyOf: [{ $ref: '#/components/schemas/Pet~1~0' }, { type: 'null' }] },
            literal: { const: { description: 'keep', properties: ['yes'] } },
          },
        },
      },
    },
    extra: ['unused array slot', { $ref: '#/parameters/query' }],
    parameters: { query: { name: 'limit', in: 'query', schema: { type: 'integer' } } },
    operations: {
      get: {
        parameters: [{ name: 'limit', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { 200: { $ref: '#/responses/pet' }, 204: { description: 'No content' } },
      },
    },
    bodies: {
      input: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/Pet~1~0' } },
          'multipart/form-data': { schema: { $ref: '#/components/schemas/Pet~1~0' } },
        },
      },
    },
    responses: {
      pet: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['pet', 'literal', 'impossible'],
              properties: {
                pet: { $ref: '#/components/schemas/Pet~1~0' },
                literal: { const: { description: ['keep', { enum: true }] } },
                impossible: false,
              },
            },
          },
        },
      },
    },
  }
  const dir = mkdtempSync(join(root, 'test/.projection-'))
  try {
    const projected = transformSpec(JSON.stringify(spec), join(dir, 'spec.openapi'))
    assert.equal(projected.diagnostics, undefined)
    const commandSource = transformSpec(JSON.stringify(spec), join(dir, 'spec.openapi-source'))
    assert.equal(commandSource.text, projected.text)
    assert.deepEqual(commandSource.mappings, [])
    const declarationEnd = projected.text.indexOf(';\n')
    const document = JSON.parse(
      projected.text.slice('declare const document: '.length, declarationEnd),
    )
    assert.equal(document.info, undefined)
    assert.equal(document.components.schemas['Pet/~'], undefined)
    assert(document.components.schemas.Path)
    assert.deepEqual(document.extra, [null, { $ref: '#/parameters/query' }])
    const full = `declare const document: ${JSON.stringify(spec)};\n${projected.text.slice(declarationEnd + 2)}`
    writeFileSync(join(dir, 'full.ts'), full)
    writeFileSync(join(dir, 'projected.ts'), projected.text)
    writeFileSync(
      join(dir, 'index.ts'),
      `
import { api as full, query as fullQuery } from './full.js';
import { api, query } from './projected.js';
const forward: typeof full = api;
const backward: typeof api = full;
const queryForward: typeof fullQuery = query;
const queryBackward: typeof query = fullQuery;
// @ts-expect-error operation parameter overrides path-level number
api.pets.get({query:{limit:1}});
api.pets.get({query:{limit:'1'}});
`,
    )
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          target: 'ES2022',
          module: 'NodeNext',
        },
        include: ['*.ts'],
      }),
    )
    const result = spawnSync(
      process.execPath,
      [join(root, 'node_modules/typescript/bin/tsc'), '-p', dir],
      {
        encoding: 'utf8',
        timeout: 30000,
      },
    )
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + result.stderr)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
