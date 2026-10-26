/* oxlint-disable vitest/no-import-node-test, antfu/no-import-dist -- Exercise compiled Content Mapper aliases across native typing and runtime. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { createClient } from '../dist/index.js'
import { transformSpec } from '../dist/tooling/transform.js'
import '../dist/tooling/register.js'
/* oxlint-enable vitest/no-import-node-test, antfu/no-import-dist */

const root = resolve(import.meta.dirname, '..')
const operation = {
  'x-client-path': ['enterprise', 'access', 'getEnvironmentApi'],
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        },
      },
    },
  },
}
const spec = {
  openapi: '3.1.0',
  paths: {
    '/environments/{id}': { get: operation },
    '/pets': { get: { responses: { 204: { description: 'Empty' } } } },
  },
}

test('explicit client paths preserve HTTP methods, defaults, error maps, query keys and inferred types', async () => {
  const directory = mkdtempSync(join(import.meta.dirname, '.aliases-'))
  const file = join(directory, 'spec.openapi')
  try {
    writeFileSync(file, JSON.stringify(spec))
    writeFileSync(
      `${file}.config.ts`,
      `export type Context = object; export default { queryKeyPrefix: ['console'] };`,
    )
    writeFileSync(
      `${file}.queries.ts`,
      `const defaults = { queryOptions: { staleTime: 42 } }; export { defaults as 'GET /environments/{id}' };`,
    )
    writeFileSync(
      `${file}.errors.ts`,
      `const errors = { DENIED: { status: 403 } }; export { errors as 'GET /environments/{id}' };`,
    )
    const { api, query } = await import(pathToFileURL(file).href)
    const requests = []
    const client = createClient({
      baseUrl: 'https://example.test',
      fetch: async (url, init) => {
        requests.push({ url: String(url), method: init.method })
        return Response.json({ id: 'a/b' })
      },
    })
    assert.deepEqual(
      await api.enterprise.access.getEnvironmentApi({ params: { id: 'a/b' } }, { client }),
      { id: 'a/b' },
    )
    assert.deepEqual(requests, [{ url: 'https://example.test/environments/a%2Fb', method: 'GET' }])
    const options = query.enterprise.access.getEnvironmentApi.queryOptions({
      input: { params: { id: 'a' } },
    })
    assert.equal(options.staleTime, 42)
    assert.deepEqual(options.queryKey[0], ['console', 'enterprise', 'access', 'getEnvironmentApi'])
    assert.equal(typeof api.pets.get, 'function')
    const denied = createClient({
      baseUrl: 'https://example.test',
      fetch: async () => Response.json({ code: 'DENIED' }, { status: 403 }),
    })
    await assert.rejects(
      api.enterprise.access.getEnvironmentApi({ params: { id: 'a' } }, { client: denied }),
      (error) => error.code === 'DENIED' && error.defined === true,
    )
    writeFileSync(
      join(directory, 'consumer.ts'),
      `
import { api, query } from './spec.openapi';
import { safe } from '@orpc/client';
const [error, data, defined] = await safe(api.enterprise.access.getEnvironmentApi({ params: { id: 'a' } }));
if (defined) { const code: 'DENIED' = error.code; }
if (data) { const id: string = data.id; }
query.enterprise.access.getEnvironmentApi.queryOptions({ input: { params: { id: 'a' } } });
// @ts-expect-error A custom member still requires the documented path parameter.
api.enterprise.access.getEnvironmentApi();
// @ts-expect-error Renamed operations are not also exposed under their URL path.
api.environments.byId.get({ params: { id: 'a' } });
`,
    )
    writeFileSync(
      join(directory, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          target: 'ES2022',
          module: 'NodeNext',
        },
        contentMappers: [{ package: root, extensions: ['.openapi'] }],
        include: ['consumer.ts'],
      }),
    )
    const result = spawnSync(
      process.execPath,
      [join(root, 'node_modules/typescript/bin/tsc'), '--runExternalCode', '-p', directory],
      { encoding: 'utf8', timeout: 60000 },
    )
    assert.equal(result.status, 0, result.stdout + result.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('client paths reject collisions and unsafe namespace members', () => {
  for (const path of [
    [],
    ['key'],
    ['then'],
    ['constructor'],
    ['pets', 'get'],
    ['pets'],
    ['pets', 'get', 'child'],
  ]) {
    const source = structuredClone(spec)
    source.paths['/environments/{id}'].get['x-client-path'] = path
    assert(
      transformSpec(JSON.stringify(source), 'test.openapi').diagnostics?.length,
      JSON.stringify(path),
    )
  }
})
