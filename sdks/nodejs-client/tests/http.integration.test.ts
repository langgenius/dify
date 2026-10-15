import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'
import { ChatClient } from '../src/client/chat'
import { KnowledgeBaseClient } from '../src/client/knowledge-base'
import { HttpClient } from '../src/http/client'

const readBody = async (stream: NodeJS.ReadableStream): Promise<Buffer> => {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

describe('HttpClient integration', () => {
  const requests: Array<{
    url: string
    method: string
    headers: Record<string, string | string[] | undefined>
    body: Buffer
  }> = []

  const server = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req)
      requests.push({
        url: req.url ?? '',
        method: req.method ?? '',
        headers: req.headers,
        body,
      })

      if (
        req.url?.startsWith('/json') ||
        req.url?.startsWith('/datasets') ||
        req.url?.startsWith('/apps/annotations')
      ) {
        res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'req-json' })
        res.end(JSON.stringify({ ok: true }))
        return
      }

      if (req.url === '/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end('data: {"answer":"hello"}\n\ndata: {"delta":" world"}\n\n')
        return
      }

      if (req.url === '/bytes') {
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        res.end(Buffer.from([1, 2, 3, 4]))
        return
      }

      if (req.url === '/upload-stream') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ received: body.toString('utf8') }))
        return
      }

      if (req.url?.startsWith('/error/')) {
        const status = Number(req.url.split('/').at(-1))
        res.writeHead(status, {
          'content-type': 'application/json',
          'x-request-id': 'req-error',
          'retry-after': '2',
        })
        res.end(JSON.stringify({ code: 'invalid_request', message: 'reported reason' }))
        return
      }

      if (req.url === '/error-text') {
        res.writeHead(502, { 'content-type': 'application/json' })
        res.end('upstream unavailable')
        return
      }

      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ message: 'not found' }))
    })()
  })

  let client: HttpClient

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address() as AddressInfo
    client = new HttpClient({
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${address.port}`,
      maxRetries: 0,
      retryDelay: 0,
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  })

  it('uses real fetch for query serialization and json bodies', async () => {
    const response = await client.request({
      method: 'POST',
      path: '/json',
      query: { tag_ids: ['a', 'b'], limit: 2 },
      data: { user: 'u' },
    })

    expect(response.requestId).toBe('req-json')
    expect(response.data).toEqual({ ok: true })
    expect(requests.at(-1)).toMatchObject({
      url: '/json?tag_ids=a&tag_ids=b&limit=2',
      method: 'POST',
    })
    expect(requests.at(-1)?.headers.authorization).toBe('Bearer test-key')
    expect(requests.at(-1)?.headers['content-type']).toBe('application/json')
    expect(requests.at(-1)?.body.toString('utf8')).toBe(JSON.stringify({ user: 'u' }))
  })

  it.each(['Content-Type', 'content-type', 'CoNtEnT-TyPe'])(
    'overrides the JSON content type with %s',
    async (headerName) => {
      await client.request({
        method: 'POST',
        path: '/json',
        data: { user: 'u' },
        headers: { [headerName]: 'application/custom+json' },
      })

      expect(requests.at(-1)?.headers['content-type']).toBe('application/custom+json')
      expect(requests.at(-1)?.body.toString('utf8')).toBe(JSON.stringify({ user: 'u' }))
    },
  )

  it('overrides authorization without combining differently cased defaults', async () => {
    await client.request({
      method: 'GET',
      path: '/json',
      headers: { authorization: 'Bearer override-key' },
    })

    expect(requests.at(-1)?.headers.authorization).toBe('Bearer override-key')
  })

  it('supports streaming request bodies with duplex fetch', async () => {
    const response = await client.request<{ received: string }>({
      method: 'POST',
      path: '/upload-stream',
      data: Readable.from(['hello ', 'world']),
    })

    expect(response.data).toEqual({ received: 'hello world' })
    expect(requests.at(-1)?.body.toString('utf8')).toBe('hello world')
  })

  it('parses real sse responses into text', async () => {
    const stream = await client.requestStream({
      method: 'GET',
      path: '/stream',
    })

    await expect(stream.toText()).resolves.toBe('hello world')
  })

  it('parses real byte responses into buffers', async () => {
    const response = await client.request<Buffer, 'bytes'>({
      method: 'GET',
      path: '/bytes',
      responseType: 'bytes',
    })

    expect(Array.from(response.data.values())).toEqual([1, 2, 3, 4])
  })

  it.each([
    { responseType: 'json', status: 401, name: 'AuthenticationError' },
    { responseType: 'stream', status: 401, name: 'AuthenticationError' },
    { responseType: 'bytes', status: 422, name: 'ValidationError' },
    { responseType: 'arraybuffer', status: 429, name: 'RateLimitError' },
  ] as const)('preserves JSON error details for $responseType responses', async (testCase) => {
    await expect(
      client.requestRaw({
        method: 'GET',
        path: `/error/${testCase.status}`,
        responseType: testCase.responseType,
      }),
    ).rejects.toMatchObject({
      name: testCase.name,
      message: 'reported reason',
      statusCode: testCase.status,
      requestId: 'req-error',
      responseBody: { code: 'invalid_request', message: 'reported reason' },
      ...(testCase.status === 429 ? { retryAfter: 2 } : {}),
    })
  })

  it('preserves a malformed JSON error body when a stream was requested', async () => {
    await expect(
      client.requestStream({ method: 'GET', path: '/error-text' }),
    ).rejects.toMatchObject({
      name: 'APIError',
      message: 'upstream unavailable',
      statusCode: 502,
      responseBody: 'upstream unavailable',
    })
  })
  const keywordRequests = [
    {
      name: 'datasets',
      path: '/datasets',
      run: (keyword: string) => new KnowledgeBaseClient(client).listDatasets({ keyword }),
    },
    {
      name: 'documents',
      path: '/datasets/ds/documents',
      run: (keyword: string) => new KnowledgeBaseClient(client).listDocuments('ds', { keyword }),
    },
    {
      name: 'segments',
      path: '/datasets/ds/documents/doc/segments',
      run: (keyword: string) =>
        new KnowledgeBaseClient(client).listSegments('ds', 'doc', { keyword }),
    },
    {
      name: 'child chunks',
      path: '/datasets/ds/documents/doc/segments/seg/child_chunks',
      run: (keyword: string) =>
        new KnowledgeBaseClient(client).listChildChunks('ds', 'doc', 'seg', { keyword }),
    },
    {
      name: 'annotations',
      path: '/apps/annotations',
      run: (keyword: string) => new ChatClient(client).listAnnotations({ keyword }),
    },
  ]

  it.each(keywordRequests)('allows an empty keyword when listing $name', async ({ path, run }) => {
    await run('')

    const url = new URL(requests.at(-1)!.url, 'http://localhost')
    expect(url.pathname).toBe(path)
    expect(url.searchParams.has('keyword')).toBe(true)
    expect(url.searchParams.get('keyword')).toBe('')
  })

  it.each(keywordRequests)(
    'still rejects oversized keywords when listing $name',
    async ({ run }) => {
      await expect(Promise.resolve().then(() => run('a'.repeat(10001)))).rejects.toThrow(
        'maximum length',
      )
    },
  )
})
