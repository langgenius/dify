/* oxlint-disable vitest/no-import-node-test, antfu/no-import-dist -- Integration tests exercise the built package in native Node, including its module hooks. */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
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
import { mediaSpec, multipartSpec, variantMedia, variantSpec } from './media.mjs'
import '../dist/tooling/register.js'
/* oxlint-enable vitest/no-import-node-test, antfu/no-import-dist */

const { api, query: generatedQuery } = await import('../examples/petstore/pets.openapi.yaml')
const pet = { id: 1, name: 'Mochi', status: 'available' }

async function readForm(request) {
  return new Response(request.body, { headers: request.headers }).formData()
}

test('multipart preserves media parameters and part header case on the HTTP wire', async () => {
  const received = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    received.push({ headers: request.headers, body: Buffer.concat(chunks) })
    response.writeHead(204)
    response.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const media =
      'multipart/form-data; profile="https://example.test/Case;boundary=Keep"; BOUNDARY="stale"'
    const partType = 'application/json; profile="https://example.test/CaseSensitive"'
    const operation = [
      ...describeOperations({
        openapi: '3.1.0',
        paths: {
          '/upload': {
            post: {
              requestBody: {
                required: true,
                content: {
                  [media]: {
                    schema: { type: 'object' },
                    encoding: { metadata: { contentType: partType } },
                  },
                },
              },
              responses: { 204: { description: 'Done' } },
            },
          },
        },
      }).values(),
    ][0]
    const client = createClient({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      headers: { 'Content-Type': 'application/json' },
    })
    const bytes = new Uint8Array([0, 255, 13, 10, 42])
    const metadata = { name: 'CaseSensitive', nested: [1, null, true] }
    await client.request(operation, {
      body: {
        metadata,
        file: new File([bytes], 'résumé.bin'),
        tags: ['one', 'two'],
        lines: 'a\nb\rc',
        'quoted"\r\nname': 'safe',
      },
    })
    const sent = received[0]
    assert.match(
      sent.headers['content-type'],
      /profile="https:\/\/example.test\/Case;boundary=Keep"/,
    )
    assert.doesNotMatch(sent.headers['content-type'], /stale/)
    const boundary = /; boundary=([^;]+)$/.exec(sent.headers['content-type'])[1]
    const wire = sent.body.toString('utf8')
    assert(wire.startsWith(`--${boundary}\r\n`))
    assert(wire.endsWith(`--${boundary}--\r\n`))
    assert(wire.includes(`Content-Type: ${partType}\r\n`))
    assert(wire.includes('name="quoted%22%0D%0Aname"'))
    const form = await new Response(sent.body, {
      headers: { 'content-type': sent.headers['content-type'] },
    }).formData()
    assert.deepEqual(JSON.parse(await form.get('metadata').text()), metadata)
    assert.equal(form.get('file').name, 'résumé.bin')
    assert.deepEqual(new Uint8Array(await form.get('file').arrayBuffer()), bytes)
    assert.deepEqual(form.getAll('tags'), ['one', 'two'])
    assert.equal(form.get('lines'), 'a\r\nb\r\nc')
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      client.request(operation, { body: { metadata }, signal: controller.signal }),
      { name: 'AbortError' },
    )
    assert.equal(received.length, 1)
    await assert.rejects(
      client.request(
        {
          ...operation,
          multipartJson: [[media, [['metadata', 'application/json;\r\nInjected: yes']]]],
        },
        { body: { metadata } },
      ),
      /Invalid multipart content type/,
    )
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('media variants select matching payload codecs in native generated clients', async () => {
  const directory = await mkdtemp(join(import.meta.dirname, '.media-variants-'))
  try {
    for (const reverse of [false, true]) {
      const spec = structuredClone(variantSpec)
      if (reverse)
        for (const path of Object.values(spec.paths))
          path.post.requestBody.content = Object.fromEntries(
            Object.entries(path.post.requestBody.content).reverse(),
          )
      const filename = join(directory, `${reverse}.openapi`)
      await writeFile(filename, JSON.stringify(spec))
      const { api } = await import(pathToFileURL(filename).href)
      const requests = []
      const client = createClient({
        baseUrl: 'https://example.test',
        fetch: async (_url, init) => {
          requests.push(init)
          return new Response(null, { status: 204 })
        },
      })
      await assert.rejects(
        api.json.post({ body: 'B' }, { client }),
        /content type must be declared/,
      )
      assert.equal(requests.length, 0)
      for (const body of ['A', 'B']) {
        await api.json.post({ body, contentType: variantMedia[`json${body}`] }, { client })
        const sent = requests.at(-1)
        assert.equal(sent.headers.get('content-type'), variantMedia[`json${body}`])
        assert.equal(sent.body, JSON.stringify(body))
      }
      await assert.rejects(
        api.json.post({ body: 'A', contentType: 'application/json; profile="a"' }, { client }),
        /content type must be declared/,
      )
      await api.form.post(
        { body: { metadata: 'wire text' }, contentType: variantMedia.formJson },
        { client },
      )
      const json = (await readForm(requests.at(-1))).get('metadata')
      assert.equal(json.type, 'application/json; charset=utf-8')
      assert.equal(await json.text(), '"wire text"')
      await api.form.post(
        {
          body: { metadata: new File(['file bytes'], 'metadata.bin') },
          contentType: variantMedia.formFile,
        },
        { client },
      )
      const file = (await readForm(requests.at(-1))).get('metadata')
      assert.equal(file.name, 'metadata.bin')
      assert.equal(await file.text(), 'file bytes')
      await api.form.post(
        { body: { metadata: 'wire text' }, contentType: 'Multipart/Form-Data; profile="json"' },
        { client },
      )
      assert.equal(await (await readForm(requests.at(-1))).get('metadata').text(), '"wire text"')
    }
    const invalid = structuredClone(variantSpec)
    invalid.paths['/form'].post.requestBody.content[variantMedia.formFile].encoding = {
      metadata: { contentType: 'text/plain' },
    }
    assert.throws(() => describeOperations(invalid), /unsupported multipart encoding/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('parameterized request media preserve headers and serialize with the right codec', async () => {
  const json = 'application/vnd.test+json; profile="CaseSensitive"'
  const binary = 'application/octet-stream; version=1'
  const operation = (content) => ({
    post: {
      requestBody: { required: true, content },
      responses: { 204: { description: 'Done' } },
    },
  })
  const spec = {
    openapi: '3.1.0',
    paths: {
      '/json': operation({ [json]: { schema: { type: 'object' } } }),
      '/default': operation({
        [json]: { schema: { type: 'number' } },
        'Application/JSON; charset=utf-8': { schema: { type: 'object' } },
      }),
      '/binary': operation({ [binary]: {} }),
      '/form': operation({
        'multipart/form-data': {
          schema: { type: 'object' },
          encoding: { metadata: { contentType: 'application/json; charset=utf-8' } },
        },
      }),
    },
  }
  const operations = [...describeOperations(spec).values()]
  const requests = []
  const client = createClient({
    baseUrl: 'https://example.test',
    fetch: async (_url, init) => {
      requests.push(init)
      return new Response(null, { status: 204 })
    },
  })
  const blob = new Blob(['bytes'])
  await client.request(operations[0], { body: { name: 'ok' } })
  assert.equal(requests[0].headers.get('content-type'), json)
  assert.equal(requests[0].body, '{"name":"ok"}')
  await client.request(operations[1], { body: { name: 'default' } })
  assert.equal(requests[1].headers.get('content-type'), 'Application/JSON; charset=utf-8')
  assert.equal(requests[1].body, '{"name":"default"}')
  await client.request(operations[2], { body: blob })
  assert.equal(requests[2].headers.get('content-type'), binary)
  assert.equal(requests[2].body, blob)
  await client.request(operations[3], { body: { metadata: { name: 'ok' } } })
  const part = (await readForm(requests[3])).get('metadata')
  assert.match(requests[3].headers.get('content-type'), /^multipart\/form-data; boundary=/i)
  assert.equal(part.type, 'application/json; charset=utf-8')
  assert.deepEqual(JSON.parse(await part.text()), { name: 'ok' })
})

test('URI fragments resolve once in native imports and both compiler projections', async () => {
  const directory = await mkdtemp(join(import.meta.dirname, '.encoded-refs-'))
  try {
    const schema = {
      type: 'object',
      properties: {
        value: { $ref: '#%2Fcomponents/schemas/Model/properties/%E9%9B%AA~1~0%2520' },
        literal: { const: { $ref: '#/literal/%ZZ' } },
      },
    }
    const spec = {
      openapi: '3.1.0',
      paths: {
        '/source': {
          post: {
            requestBody: { $ref: '#/components/requestBodies/%49nput' },
            responses: { 200: { description: 'OK', content: { 'application/json': { schema } } } },
          },
        },
        '/copy': { $ref: '#/paths/%7E1source' },
      },
      components: {
        schemas: { Model: { type: 'object', properties: { '雪/~%20': { type: 'number' } } } },
        requestBodies: { Input: { required: true, content: { 'application/json': { schema } } } },
      },
    }
    const content = JSON.stringify(spec)
    const filename = join(directory, 'spec.openapi')
    const projected = transformSpec(content, filename)
    assert.equal(projected.diagnostics, undefined)
    const command = transformSpec(content, join(directory, 'spec.openapi-source'))
    assert.equal(command.text, projected.text)
    await writeFile(filename, content)
    const { api } = await import(pathToFileURL(filename).href)
    const body = { value: 42, literal: { $ref: '#/literal/%ZZ' } }
    const client = createClient({
      baseUrl: 'https://example.test',
      fetch: async (url, init) => {
        assert.equal(url.pathname, '/copy')
        assert.deepEqual(JSON.parse(init.body), body)
        return Response.json(body)
      },
    })
    assert.deepEqual(await api.copy.post({ body }, { client }), body)
    spec.paths['/copy'].$ref = '#/paths/%ZZ'
    assert.match(transformSpec(JSON.stringify(spec), filename).diagnostics[0].messageText, /URI/)
    spec.paths['/copy'].$ref = 'https://example.test/spec#/paths/~1source'
    assert.match(
      transformSpec(JSON.stringify(spec), filename).diagnostics[0].messageText,
      /Only local/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('JSON multipart parts retain nested payloads alongside binary files', async () => {
  const body = {
    file: new File(['file bytes'], 'upload.bin'),
    metadata: { content: 'wire text', nullable: null, next: { content: 'nested' } },
    parts: ['one', 'two'],
  }
  const client = createClient({
    baseUrl: 'https://example.test',
    fetch: async (_url, init) => {
      assert.match(init.headers.get('content-type'), /^multipart\/form-data; boundary=/i)
      const form = await readForm(init)
      assert.equal(await form.get('file').text(), 'file bytes')
      assert.equal(form.get('file').name, 'upload.bin')
      assert.equal(form.get('metadata').type, 'application/json')
      assert.deepEqual(JSON.parse(await form.get('metadata').text()), body.metadata)
      assert.deepEqual(JSON.parse(await form.get('parts').text()), body.parts)
      assert.equal(form.has('optional'), false)
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
          responseContentTypes: { 200: [type, '*/*'] },
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
      fetch: async () =>
        new Response(stream, { headers: { 'content-type': 'Text/Event-Stream; charset=utf-8' } }),
    })
    // A still-open SSE stream must be returned immediately, not buffered into a Blob.
    const result = await client.request({
      ...operation,
      responseContentTypes: { 200: ['Text/Event-Stream; charset=utf-8', '*/*'] },
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
