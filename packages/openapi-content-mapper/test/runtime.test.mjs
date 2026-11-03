/* oxlint-disable vitest/no-import-node-test, antfu/no-import-dist -- Integration tests exercise the built package in native Node, including its module hooks. */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { QueryClient } from '@tanstack/query-core'
import { invokeRpcOperation } from '../dist/client.js'
import { ApiError, createClient, client as defaultClient } from '../dist/index.js'
import { describeOperations } from '../dist/operation.js'
import { createQueryKey, createQueryOperation } from '../dist/query-runtime.js'
import { compileRuntime, transformSpec } from '../dist/tooling/transform.js'
import { mediaSpec } from './media.mjs'
import '../dist/tooling/register.js'
/* oxlint-enable vitest/no-import-node-test, antfu/no-import-dist */

const { api, query: generatedQuery } = await import('../examples/petstore/pets.openapi.yaml')
const pet = { id: 1, name: 'Mochi', status: 'available' }

test('wildcard response media preserve Blob types, specific matches and HTTP errors', async () => {
  const response = (...media) => ({ content: Object.fromEntries(media.map((type) => [type, {}])) })
  const operation = describeOperations({
    openapi: '3.1.0',
    paths: {
      '/files': {
        get: {
          operationId: 'file',
          responses: {
            '2XX': { $ref: '#/components/responses/File' },
            201: response('application/json', '*/*'),
            202: response('text/*', '*/*'),
            203: response('application/*', '*/*'),
            206: response('text/plain'),
          },
        },
      },
    },
    components: { responses: { File: response('*/*') } },
  }).get('file')
  let reply
  const client = createClient({ baseUrl: 'https://example.test', fetch: async () => reply })
  for (const [status, contentType, expected] of [
    [200, 'text/plain', 'blob'],
    [200, 'application/json', 'blob'],
    [200, 'text/event-stream', 'blob'],
    [201, 'application/json', 'json'],
    [201, 'text/plain', 'blob'],
    [202, 'text/event-stream', 'text'],
    [203, 'application/json', 'blob'],
    [206, 'text/plain', 'text'],
  ]) {
    reply = new Response('123', { status, headers: { 'content-type': contentType } })
    const value = await client.request(operation)
    if (expected === 'blob') {
      assert(value instanceof Blob, `${status} ${contentType}`)
      assert.equal(await value.text(), '123')
    } else assert.equal(value, expected === 'json' ? 123 : '123')
  }
  reply = Response.json({ code: 'DENIED' }, { status: 403 })
  await assert.rejects(client.request(operation), (error) => {
    assert(error instanceof ApiError)
    assert.deepEqual(error.data, { code: 'DENIED' })
    return true
  })
})

test('document sidecar automatically binds only API and query exports in Node', async () => {
  const dir = await mkdtemp(join(import.meta.dirname, '.config-'))
  try {
    const file = join(dir, 'api.openapi')
    await writeFile(
      file,
      JSON.stringify({
        openapi: '3.1.0',
        paths: {
          ...Object.fromEntries(
            ['then', 'api', 'query', 'default'].map((operationId, index) => [
              index ? `/pets/${operationId}` : '/pets',
              { get: { operationId, responses: { 200: { description: 'OK' } } } },
            ]),
          ),
        },
      }),
    )
    await writeFile(
      `${file}.config.ts`,
      `
import { createClient } from '@dify/openapi-content-mapper';
export type Context = { user?: string };
export default {
  queryKeyPrefix: ['app'],
  createClient: ({ context }) => createClient({
    baseUrl: 'https://bound.test',
    fetch: async (url) => Response.json({ url: String(url), user: context?.user }),
  }),
};
`,
    )
    const bound = await import(pathToFileURL(file).href)
    assert.deepEqual(Object.keys(bound), ['api', 'query'])
    assert.equal((await bound.api.pets.get()).url, 'https://bound.test/pets')
    assert.equal(
      (await bound.api.pets.get(undefined, { context: { user: 'alice' } })).user,
      'alice',
    )
    const options = bound.query.pets.get.queryOptions({ input: {}, context: { user: 'bob' } })
    assert.equal((await options.queryFn({ signal: new AbortController().signal })).user, 'bob')
    assert.deepEqual(bound.query.pets.key(), [['app', 'pets'], {}])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('document configuration shares transport and keys without leaking per-call context', async () => {
  const operation = { method: 'get', path: '/pets' }
  const seen = []
  const errors = []
  const config = {
    queryKeyPrefix: ['console'],
    createClient: ({ context, signal }) =>
      createClient({
        baseUrl: `https://${context.user}.example.test`,
        fetch: async (url, init) => {
          seen.push([String(url), init.signal === signal])
          return Response.json(pet)
        },
      }),
    onError: (error) => errors.push(error),
  }
  const query = createQueryOperation(operation, ['pets', 'get'], config)
  const controller = new AbortController()
  await Promise.all([
    invokeRpcOperation(
      operation,
      {},
      { context: { user: 'alice' }, signal: controller.signal },
      config,
    ),
    query.queryOptions({ context: { user: 'bob' } }).queryFn({ signal: controller.signal }),
    invokeRpcOperation(operation, {}, { context: { user: 'carol' } }, config),
  ])
  assert.deepEqual(seen.map(([url]) => url).sort(), [
    'https://alice.example.test/pets',
    'https://bob.example.test/pets',
    'https://carol.example.test/pets',
  ])
  assert(seen.every(([, forwarded]) => forwarded))
  assert.deepEqual(createQueryKey([], config)(), [['console'], {}])
  assert.deepEqual(query.queryKey()[0], ['console', 'pets', 'get'])
  const failure = new Error('failed')
  const override = createClient({
    baseUrl: 'https://override.test',
    fetch: async () => {
      throw failure
    },
  })
  await assert.rejects(
    invokeRpcOperation(operation, {}, { client: override }, config),
    (error) => error === failure,
  )
  assert.deepEqual(errors, [failure])
})

test('nested client sends params/query/body, headers and cancellation through Fetch', async () => {
  const calls = []
  const client = createClient({
    baseUrl: 'https://example.test/v1',
    headers: { Authorization: 'Bearer test-only' },
    fetch: async (url, init) => {
      calls.push({ url: String(url), ...init })
      if (init.method === 'DELETE') return new Response(null, { status: 204 })
      return Response.json(pet)
    },
  })
  const controller = new AbortController()
  assert.deepEqual(
    await api.pets.byPetId.get({ params: { petId: 1 } }, { client, signal: controller.signal }),
    pet,
  )
  assert.equal(calls[0].url, 'https://example.test/v1/pets/1')
  assert.equal(calls[0].headers.get('authorization'), 'Bearer test-only')
  assert.equal(calls[0].signal, controller.signal)
  await api.pets.get({ query: { status: 'available', limit: 0 } }, { client })
  assert.match(calls[1].url, /limit=0/)
  assert.match(calls[1].url, /status=available/)
  await api.pets.post({ body: { name: '雪团' } }, { client, headers: { 'X-Test': '1' } })
  assert.equal(calls[2].body, '{"name":"雪团"}')
  assert.equal(calls[2].headers.get('content-type'), 'application/json')
  assert.equal(calls[2].headers.get('x-test'), '1')
  assert.equal(await api.pets.byPetId.delete({ params: { petId: 1 } }, { client }), undefined)
  await assert.rejects(api.pets.byPetId.get({}, { client }), /Missing required path/)
  await assert.rejects(api.pets.post({}, { client }), /Missing required request body/)
  assert.equal(calls.length, 4, 'Missing required input must fail before sending a request')
})

test('HTTP errors preserve status and payload; abort errors are not swallowed', async () => {
  const client = createClient({
    baseUrl: 'https://example.test',
    fetch: async () => Response.json({ message: 'Missing' }, { status: 404 }),
  })
  await assert.rejects(api.pets.byPetId.get({ params: { petId: 1 } }, { client }), (error) => {
    assert(error instanceof ApiError)
    assert.equal(error.response.status, 404)
    assert.deepEqual(error.data, { message: 'Missing' })
    return true
  })
  client.setConfig({
    fetch: async (_url, init) => {
      init.signal.throwIfAborted()
      return Response.json(pet)
    },
  })
  const reason = new Error('cancelled')
  await assert.rejects(
    api.pets.byPetId.get({ params: { petId: 1 } }, { client, signal: AbortSignal.abort(reason) }),
    (error) => error === reason,
  )
})

test('OpenAPI serializers escape path segments, encode query arrays/objects, and apply parameter overrides', async () => {
  const spec = {
    openapi: '3.1.0',
    paths: {
      '/files/{key}': {
        parameters: [
          { name: 'key', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'tag', in: 'query', required: true },
        ],
        get: {
          operationId: 'getFile',
          parameters: [
            { name: 'tag', in: 'query', required: false },
            { name: 'filter', in: 'query', style: 'deepObject', explode: true },
            { name: 'x-tags', in: 'header', style: 'simple' },
          ],
          responses: { 200: { description: 'ok' } },
        },
      },
    },
  }
  const operation = describeOperations(spec).get('getFile')
  let observed
  const client = createClient({
    baseUrl: 'https://example.test/base/',
    fetch: async (url, options) => {
      observed = { url, options }
      return new Response('ok', { headers: { 'Content-Type': 'text/plain' } })
    },
  })
  assert.equal(
    await client.request(operation, {
      path: { key: 'a/b c' },
      query: { tag: ['one&two', 'three'], filter: { active: false } },
      header: { 'x-tags': ['a', 'b'] },
    }),
    'ok',
  )
  assert.equal(observed.url.pathname, '/base/files/a%2Fb%20c')
  assert.deepEqual(observed.url.searchParams.getAll('tag'), ['one&two', 'three'])
  assert.equal(observed.url.searchParams.get('filter[active]'), 'false')
  assert.equal(observed.options.headers.get('x-tags'), 'a,b')
  await client.request(operation, { path: { key: 'ok' } })
})

test('existing oRPC TanStack Query helpers infer and execute nested calls', async () => {
  const before = defaultClient.getConfig()
  defaultClient.setConfig({
    baseUrl: 'https://example.test',
    fetch: async () => Response.json(pet),
  })
  const queryClient = new QueryClient()
  try {
    const query = createTanstackQueryUtils(api)
    const options = query.pets.byPetId.get.queryOptions({ input: { params: { petId: 1 } } })
    assert.deepEqual(await queryClient.fetchQuery(options), pet)
    assert.deepEqual(queryClient.getQueryData(options.queryKey), pet)
    const generatedOptions = generatedQuery.pets.byPetId.get.queryOptions({
      input: { params: { petId: 1 } },
    })
    assert.deepEqual(await queryClient.fetchQuery(generatedOptions), pet)
    assert.deepEqual(generatedQuery.pets.key(), query.pets.key())
    assert.deepEqual(generatedQuery.pets.byPetId.get.key(), query.pets.byPetId.get.key())
  } finally {
    defaultClient.setConfig({ baseUrl: undefined, fetch: undefined, headers: undefined, ...before })
    queryClient.clear()
  }
})

test('mapper and runtime reject the same invalid documents and route names', () => {
  const operation = (id) => ({ operationId: id, responses: { 200: { description: 'ok' } } })
  for (const [spec, expected] of [
    [
      {
        openapi: '3.1.0',
        paths: {
          '/x': {
            get: { ...operation('x'), responses: { 200: { $ref: 'remote.yaml#/Response' } } },
          },
        },
      },
      /Only local JSON Pointer/,
    ],
    [
      {
        openapi: '3.1.0',
        paths: { '/x': { get: operation('a') }, '/x/get': { get: operation('b') } },
      },
      /collides with an existing member/,
    ],
    [
      { openapi: '3.1.0', paths: { '/x': { get: operation('a'), post: operation('a') } } },
      /Duplicate operationId/,
    ],
    [
      { openapi: '3.1.0', paths: {}, components: { schemas: { X: { $ref: '#/missing' } } } },
      /Unresolved reference/,
    ],
    ['openapi: 3.1.0\npaths: {}\nx-value: .inf', /non-finite numbers/],
    ['openapi: 3.1.0\npaths: {}\n? [complex, key]\n: value', /keys must be strings or numbers/],
    ['openapi: 3.1.0\npaths: {}\nx-value: &value {}\nx-alias: *value', /alias/i],
  ]) {
    const content = typeof spec === 'string' ? spec : JSON.stringify(spec)
    const result = transformSpec(content, 'spec.openapi')
    assert.match(result.diagnostics[0].messageText, expected)
    assert.throws(() => compileRuntime(content, 'spec.openapi'), expected)
  }
})

test('nested typed headers reach Fetch alongside transport headers without filling schema defaults', async () => {
  const calls = []
  const client = createClient({
    baseUrl: 'https://example.test',
    headers: { Authorization: 'Bearer shared' },
    fetch: async (url, init) => {
      calls.push({ url, ...init })
      return Response.json({})
    },
  })
  const operation = {
    method: 'post',
    path: '/settings',
    parameters: [
      { in: 'header', name: 'Idempotency-Key', required: true, style: 'simple', explode: false },
      { in: 'header', name: 'X-Tags', required: false, style: 'simple', explode: false },
    ],
  }
  const result = await invokeRpcOperation(
    operation,
    { headers: { 'Idempotency-Key': 'key', 'X-Tags': ['a', 'b'] } },
    { client, headers: { 'X-Transport': 'extra' } },
  )
  assert.equal(calls[0].headers.get('Idempotency-Key'), 'key')
  assert.equal(calls[0].headers.get('X-Tags'), 'a,b')
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer shared')
  assert.equal(calls[0].headers.get('X-Transport'), 'extra')
  assert.deepEqual(result, {})
  await assert.rejects(invokeRpcOperation(operation, {}, { client }), /Missing required header/)
})

test('request media defaults agree with types and JSON responses preserve wire values', async () => {
  const operations = [...describeOperations(mediaSpec).values()]
  const operation = (path) => operations.find((operation) => operation.path === path)
  const calls = []
  const client = createClient({
    baseUrl: 'https://example.test',
    fetch: async (_url, init) => {
      calls.push(init)
      return Response.json({ inline: 'inline', referenced: 'referenced' })
    },
  })
  await client.request(operation('/mixed'), { body: { kind: 'standard' } })
  assert.equal(calls.at(-1).headers.get('content-type'), 'application/json')
  await client.request(operation('/mixed'), {
    body: { kind: 'vendor' },
    contentType: 'application/vnd.example+json',
  })
  assert.equal(calls.at(-1).headers.get('content-type'), 'application/vnd.example+json')
  assert.equal(calls.at(-1).body, '{"kind":"vendor"}')
  await client.request(operation('/single'), { body: { kind: 'single' } })
  assert.equal(calls.at(-1).headers.get('content-type'), 'application/vnd.example+json')
  await assert.rejects(
    client.request(operation('/vendors'), { body: { kind: 'second' } }),
    /content type/,
  )
  await assert.rejects(client.request(operation('/vendors')), /Missing required request body/)
  assert.equal(calls.length, 3, 'Ambiguous media and missing bodies fail before sending')
  await client.request(operation('/vendors'), {
    body: { kind: 'second' },
    contentType: 'application/vnd.second+json',
  })
  assert.equal(calls.at(-1).headers.get('content-type'), 'application/vnd.second+json')
  assert.deepEqual(await client.request(operation('/binary')), {
    inline: 'inline',
    referenced: 'referenced',
  })
})

test('downloads preserve filenames, encoded names, media type and bytes', async () => {
  const bytes = new Uint8Array([0x50, 0x4b, 0x00, 0xff])
  for (const [disposition, name] of [
    ['attachment; filename="agent.ifpkg"', 'agent.ifpkg'],
    ['attachment; filename="fallback.zip"; filename*=UTF-8\'\'%E7%9F%A5%E8%AF%86.zip', '知识.zip'],
    ['attachment', 'blob'],
  ]) {
    const client = createClient({
      baseUrl: 'https://example.test',
      fetch: async () =>
        new Response(bytes, {
          headers: {
            'content-type': 'application/zip',
            'content-disposition': disposition,
          },
        }),
    })
    const result = await client.request({ method: 'get', path: '/download' })
    assert(result instanceof File)
    assert.equal(result.name, name)
    assert.equal(result.type, 'application/zip')
    assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes)
  }
})
