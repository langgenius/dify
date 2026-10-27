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
import { mediaSpec, multipartSpec } from './media.mjs'
import '../dist/tooling/register.js'
/* oxlint-enable vitest/no-import-node-test, antfu/no-import-dist */

const { api, query: generatedQuery } = await import('../examples/petstore/pets.openapi.yaml')
const pet = { id: 1, name: 'Mochi', status: 'available' }

test('JSON multipart parts retain nested payloads alongside binary files', async () => {
  const body = {
    file: new File(['file bytes'], 'upload.bin'),
    metadata: { content: 'wire text', nullable: null, next: { content: 'nested' } },
    parts: ['one', 'two'],
  }
  const client = createClient({
    baseUrl: 'https://example.test',
    fetch: async (_url, init) => {
      assert.equal(init.headers.has('content-type'), false)
      assert.equal(await init.body.get('file').text(), 'file bytes')
      assert.equal(init.body.get('file').name, 'upload.bin')
      assert.equal(init.body.get('metadata').type, 'application/json')
      assert.deepEqual(JSON.parse(await init.body.get('metadata').text()), body.metadata)
      assert.deepEqual(JSON.parse(await init.body.get('parts').text()), body.parts)
      assert.equal(init.body.has('optional'), false)
      return new Response(null, { status: 204 })
    },
  })
  for (const operation of describeOperations(multipartSpec).values())
    await client.request(operation, { body })
})

test(
  'response media decoding ignores case and preserves wildcard precedence and errors',
  { timeout: 2000 },
  async () => {
    const client = createClient({ baseUrl: 'https://example.test' })
    const operation = { method: 'get', path: '/payload' }
    for (const type of ['Application/JSON; Charset=UTF-8', 'APPLICATION/PROBLEM+JSON']) {
      client.setConfig({
        fetch: async () => new Response('{"name":"Mochi"}', { headers: { 'content-type': type } }),
      })
      assert.deepEqual(await client.request(operation), { name: 'Mochi' })
      assert.deepEqual(
        await client.request({
          ...operation,
          responseContentTypes: { 200: [type.split(';')[0], '*/*'] },
        }),
        { name: 'Mochi' },
      )
      const binary = await client.request({
        ...operation,
        responseContentTypes: { 200: ['Application/*'] },
      })
      assert(binary instanceof Blob)
    }
    client.setConfig({
      fetch: async () => new Response('hello', { headers: { 'content-type': 'TEXT/PLAIN' } }),
    })
    assert.equal(await client.request(operation), 'hello')
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: hello\n\n'))
      },
    })
    client.setConfig({
      fetch: async () => new Response(stream, { headers: { 'content-type': 'Text/Event-Stream' } }),
    })
    // A still-open SSE stream must be returned immediately, not buffered into a Blob.
    const result = await client.request({
      ...operation,
      responseContentTypes: { 200: ['Text/Event-Stream', '*/*'] },
    })
    assert.equal(result, stream)
    await result.cancel()
    client.setConfig({
      fetch: async () =>
        new Response('{"code":"DENIED"}', {
          status: 403,
          headers: { 'content-type': 'APPLICATION/JSON' },
        }),
    })
    await assert.rejects(client.request(operation), (error) => {
      assert(error instanceof ApiError)
      assert.deepEqual(error.data, { code: 'DENIED' })
      return true
    })
  },
)

test('commented star re-exports retain query defaults and typed error maps in Node', async () => {
  const directory = await mkdtemp(join(import.meta.dirname, '.sidecar-comments-'))
  try {
    await writeFile(
      join(directory, 'defaults.ts'),
      `const defaults={queryOptions:{staleTime:1234,retry:false}};export {defaults as 'GET /pets'};`,
    )
    await writeFile(
      join(directory, 'errors.ts'),
      `const errors={DENIED:{status:403}};export {errors as 'GET /pets'};`,
    )
    const spec = JSON.stringify({
      openapi: '3.1.0',
      paths: { '/pets': { get: { responses: { 200: { description: 'OK' } } } } },
    })
    const statements = [
      (file) => `export/* shared */*/* policy */from/* module */'./${file}.ts';`,
      (file) => `export // shared\n * // policy\r\n from './${file}.ts';`,
      (file) => `export*from'./${file}.ts';`,
    ]
    const client = createClient({
      baseUrl: 'https://example.test',
      fetch: async () =>
        new Response('{"code":"DENIED"}', {
          status: 403,
          headers: { 'content-type': 'Application/JSON' },
        }),
    })
    for (const [index, statement] of statements.entries()) {
      const file = join(directory, `spec${index}.openapi`)
      await writeFile(file, spec)
      await writeFile(`${file}.queries.ts`, statement('defaults'))
      await writeFile(`${file}.errors.ts`, statement('errors'))
      const { api, query } = await import(pathToFileURL(file).href)
      assert.equal(query.pets.get.queryOptions().staleTime, 1234)
      assert.equal(query.pets.get.queryOptions().retry, false)
      await assert.rejects(api.pets.get(undefined, { client }), (error) => {
        assert.equal(error.code, 'DENIED')
        assert.equal(error.defined, true)
        return true
      })
    }
    const file = join(directory, 'namespace.openapi')
    await writeFile(file, spec)
    await writeFile(
      `${file}.queries.ts`,
      "export /* namespace */ * as policies from './defaults.ts';",
    )
    const { query } = await import(pathToFileURL(file).href)
    assert.equal(query.pets.get.queryOptions().staleTime, undefined)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

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

test('HTTP decoding failures retain status, raw payload and cause without masking cancellation', async () => {
  for (const [status, body] of [
    [401, ''],
    [502, 'upstream failed'],
  ]) {
    const response = new Response(body, { status, headers: { 'content-type': 'application/json' } })
    const client = createClient({ baseUrl: 'https://example.test', fetch: async () => response })
    let observed
    await assert.rejects(
      invokeRpcOperation(
        { method: 'get', path: '/pets' },
        {},
        { client },
        {
          onError: (error) => {
            observed = error
          },
        },
      ),
      (error) => {
        assert(error instanceof ApiError)
        assert.equal(error.response, response)
        assert.equal(error.response.status, status)
        assert.equal(error.data, body)
        assert(error.cause instanceof SyntaxError)
        assert.equal(observed, error)
        return true
      },
    )
  }
  const controller = new AbortController()
  const reason = new Error('cancelled while reading')
  const client = createClient({
    baseUrl: 'https://example.test',
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(stream) {
            controller.abort(reason)
            stream.error(reason)
          },
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
  })
  await assert.rejects(
    client.request({ method: 'get', path: '/pets' }, { signal: controller.signal }),
    (error) => error === reason,
  )
  const networkError = new TypeError('connection closed while reading')
  client.setConfig({
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(stream) {
            stream.error(networkError)
          },
        }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      ),
  })
  await assert.rejects(
    client.request({ method: 'get', path: '/pets' }),
    (error) => error === networkError,
  )
  client.setConfig({
    fetch: async () => new Response('invalid', { headers: { 'content-type': 'application/json' } }),
  })
  await assert.rejects(client.request({ method: 'get', path: '/pets' }), SyntaxError)
})

test('literal $ref payloads are preserved while actual references are validated', () => {
  const literal = { $ref: 'ordinary payload', nested: { $ref: '#/not-a-reference' } }
  const spec = {
    openapi: '3.1.0',
    paths: {
      '/payload': {
        get: {
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  example: literal,
                  examples: { payload: { $ref: '#/components/examples/Payload' } },
                  schema: { $ref: '#/components/schemas/Payload' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      examples: { Payload: { value: literal } },
      schemas: {
        Payload: {
          type: 'object',
          properties: {
            $ref: { type: 'string' },
            literal: { const: literal },
            choices: { enum: [literal] },
          },
          example: literal,
          default: literal,
          'x-data': literal,
        },
      },
    },
  }
  for (const extension of ['openapi', 'openapi-source']) {
    const result = transformSpec(JSON.stringify(spec), `/tmp/payload.${extension}`)
    assert.equal(result.diagnostics, undefined)
    assert(result.text.includes('ordinary payload'))
  }
  assert.doesNotThrow(() => compileRuntime(JSON.stringify(spec), '/tmp/payload.openapi'))
  spec.components.schemas.Payload.properties.$ref = { $ref: '#/components/schemas/Missing' }
  assert.match(
    transformSpec(JSON.stringify(spec), '/tmp/payload.openapi').diagnostics[0].messageText,
    /Unresolved reference/,
  )
  assert.throws(
    () => compileRuntime(JSON.stringify(spec), '/tmp/payload.openapi'),
    /Unresolved reference/,
  )
})

test('binary uploads without a schema send Blob bytes', async () => {
  const operation = describeOperations({
    openapi: '3.1.0',
    paths: {
      '/upload': {
        post: {
          operationId: 'upload',
          requestBody: { required: true, content: { 'application/octet-stream': {} } },
          responses: { 204: { description: 'Done' } },
        },
      },
    },
  }).get('upload')
  const body = new Blob(['file bytes'])
  const client = createClient({
    baseUrl: 'https://example.test',
    fetch: async (_url, init) => {
      assert.equal(init.body, body)
      assert.equal(init.headers.get('content-type'), 'application/octet-stream')
      return new Response(null, { status: 204 })
    },
  })
  assert.equal(await client.request(operation, { body }), undefined)
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

test('path parameters cannot normalize write requests to a different route', async () => {
  const urls = []
  const client = createClient({
    baseUrl: 'https://example.test/v1',
    fetch: async (url) => {
      urls.push(url.pathname)
      return new Response(null, { status: 204 })
    },
  })
  const operation = {
    method: 'delete',
    path: '/files/{id}',
    parameters: [{ in: 'path', name: 'id', required: true, style: 'simple', explode: false }],
  }
  for (const id of ['.', '..', ['.'], ['..']])
    await assert.rejects(client.request(operation, { path: { id } }), /dot segments/)
  await assert.rejects(
    client.request({ ...operation, path: '/files/%2E{id}' }, { path: { id: '.' } }),
    /dot segments/,
  )
  assert.deepEqual(urls, [])
  for (const id of ['normal', '..txt', 'a/b', '%2e%2e'])
    await client.request(operation, { path: { id } })
  await client.request({ ...operation, path: '/files/{id}.json' }, { path: { id: '.' } })
  assert.deepEqual(urls, [
    '/v1/files/normal',
    '/v1/files/..txt',
    '/v1/files/a%2Fb',
    '/v1/files/%252e%252e',
    '/v1/files/..json',
  ])
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

test('Content-Disposition preserves JSON, text, SSE and wildcard decoding', async () => {
  const client = createClient({ baseUrl: 'https://example.test' })
  for (const disposition of ['inline', 'attachment; filename="payload.txt"']) {
    for (const [type, body, expected] of [
      ['application/json', '{"id":1}', { id: 1 }],
      ['application/problem+json', '{"id":1}', { id: 1 }],
      ['text/plain', 'hello', 'hello'],
      ['text/event-stream', 'data: hello\n\n', 'stream'],
    ]) {
      const response = new Response(body, {
        headers: { 'content-type': type, 'content-disposition': disposition },
      })
      client.setConfig({ fetch: async () => response })
      const result = await client.request({ method: 'get', path: '/payload' })
      if (expected === 'stream') assert.equal(result, response.body)
      else assert.deepEqual(result, expected)
    }
  }
  client.setConfig({
    fetch: async () =>
      Response.json(
        { id: 1 },
        { headers: { 'content-disposition': 'attachment; filename="payload.json"' } },
      ),
  })
  const result = await client.request({
    method: 'get',
    path: '/payload',
    responseContentTypes: { 200: ['*/*'] },
  })
  assert(result instanceof File)
  assert.equal(result.name, 'payload.json')
  assert.equal(await result.text(), '{"id":1}')
})
