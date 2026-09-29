import type { AddressInfo } from 'node:net'
import * as http from 'node:http'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { createHttpClient } from './client.js'

type Stub = { url: string; stop: () => Promise<void> }

function startStub(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<Stub> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        stop: () =>
          new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      })
    })
    server.on('error', reject)
  })
}

describe('custom undici dispatcher path (insecure: true)', () => {
  const stubs: Stub[] = []

  afterEach(async () => {
    while (stubs.length > 0) await stubs.pop()?.stop()
  })

  it('follows POST+json through a 307 redirect with a replayable body', async () => {
    let destinationBody = ''
    const dest = await startStub((req, res) => {
      let data = ''
      req.on('data', (chunk) => {
        data += chunk
      })
      req.on('end', () => {
        destinationBody = data
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
    })
    stubs.push(dest)

    const redirect = await startStub((_req, res) => {
      res.writeHead(307, { location: `${dest.url}/final` })
      res.end()
    })
    stubs.push(redirect)

    const client = createHttpClient({ baseURL: redirect.url, retryAttempts: 0, insecure: true })
    const body = await client.post<{ ok: boolean }>('go', { json: { hello: 'world' } })
    expect(body.ok).toBe(true)
    expect(destinationBody).toBe(JSON.stringify({ hello: 'world' }))
  })

  it('does not retry non-retryable HTTP statuses from undici fetch', async () => {
    let hits = 0
    const stub = await startStub((_req, res) => {
      hits += 1
      res.writeHead(404)
      res.end()
    })
    stubs.push(stub)

    const client = createHttpClient({ baseURL: stub.url, retryAttempts: 1, insecure: true })
    const res = await client.fetch('missing')
    expect(res.status).toBe(404)
    expect(hits).toBe(1)
  })

  it('sends the Request produced by onRequest hooks', async () => {
    let seenPath: string | undefined
    const stub = await startStub((req, res) => {
      seenPath = req.url
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })
    stubs.push(stub)

    const client = createHttpClient({
      baseURL: stub.url,
      retryAttempts: 0,
      insecure: true,
      hooks: {
        onRequest: (ctx) => {
          ctx.request = new Request(new URL('/rewritten', stub.url), ctx.request)
        },
      },
    })

    // Hook replaces ctx.request; the undici branch must send the replacement URL.
    await client.get('original')
    expect(seenPath).toBe('/rewritten')
  })

  it('honors redirect: manual on the low-level request() entrypoint', async () => {
    const dest = await startStub((_req, res) => {
      res.writeHead(200)
      res.end('dest')
    })
    stubs.push(dest)

    const redirect = await startStub((_req, res) => {
      res.writeHead(307, { location: dest.url })
      res.end()
    })
    stubs.push(redirect)

    const client = createHttpClient({ baseURL: redirect.url, retryAttempts: 0, insecure: true })
    const res = await client.request(new Request(`${redirect.url}/start`, { redirect: 'manual' }))
    expect(res.status).toBe(307)
  })
})
