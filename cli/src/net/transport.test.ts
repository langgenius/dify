import type { Server } from 'node:http'
import type { Http2SecureServer, ServerHttp2Stream } from 'node:http2'
import type { Socket } from 'node:net'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createSecureServer } from 'node:http2'
import { createServer as createHttpsServer } from 'node:https'
import { connect } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const PROXY_KEYS = [
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'NO_PROXY',
  'no_proxy',
]
const sockets = new Set<Socket>()
const servers: (Server | Http2SecureServer)[] = []
const dispatchers: { destroy: () => Promise<void> }[] = []
// Public, self-signed fixtures for the local TLS server; never used for credentials.
const certificate = {
  key: readFileSync(new URL('../../test/fixtures/tls/key.pem', import.meta.url)),
  cert: readFileSync(new URL('../../test/fixtures/tls/cert.pem', import.meta.url)),
}

async function listen(server: Server | Http2SecureServer, secure = false) {
  servers.push(server)
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing transport test address')
  return `${secure ? 'https' : 'http'}://127.0.0.1:${address.port}`
}

async function deviceServer(secure = false) {
  const server = secure ? createHttpsServer(certificate) : createServer()
  server.on('request', (_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(
      JSON.stringify({
        device_code: 'transport-code',
        user_code: 'TEST',
        verification_uri: 'https://example.com/verify',
        expires_in: 60,
        interval: 1,
      }),
    )
  })
  return listen(server, secure)
}

async function proxyServer() {
  const destinations: string[] = []
  const server = createServer()
  server.on('connect', (request, client, head) => {
    const destination = new URL(`http://${request.url}`)
    destinations.push(destination.host)
    const upstream = connect(Number(destination.port), destination.hostname, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.write(head)
      upstream.pipe(client)
      client.pipe(upstream)
    })
    sockets.add(upstream)
    upstream.once('close', () => sockets.delete(upstream))
    upstream.on('error', () => client.destroy())
    client.on('error', () => upstream.destroy())
    client.once('close', () => upstream.destroy())
  })
  return { url: await listen(server), destinations }
}

beforeEach(() => {
  for (const key of PROXY_KEYS) vi.stubEnv(key, undefined)
  vi.resetModules()
})
afterEach(async () => {
  await Promise.all(dispatchers.splice(0).map((dispatcher) => dispatcher.destroy()))
  for (const socket of sockets) socket.destroy()
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        }),
    ),
  )
  vi.unstubAllEnvs()
})

describe('device flow transport', () => {
  it.each(['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy'])(
    'uses %s for real proxy dispatch',
    async (key) => {
      const secure = key.toLowerCase() === 'https_proxy'
      const target = await deviceServer(secure)
      const proxy = await proxyServer()
      vi.stubEnv(key, proxy.url)
      const { deviceApi } = await import('../auth/device-api')
      const { proxyDispatcher } = await import('./proxy')
      dispatchers.push(proxyDispatcher({ insecure: true })!)

      const result = await deviceApi(target, { insecure: true }).requestCode({
        device_label: 'transport',
      })

      expect(result.device_code).toBe('transport-code')
      expect(proxy.destinations).toEqual([new URL(target).host])
    },
  )

  it.each(['NO_PROXY', 'no_proxy'])('honors %s when a proxy is configured', async (key) => {
    const target = await deviceServer()
    const proxy = await proxyServer()
    vi.stubEnv('HTTP_PROXY', proxy.url)
    vi.stubEnv(key, '127.0.0.1')
    const { deviceApi } = await import('../auth/device-api')
    const { proxyDispatcher } = await import('./proxy')
    dispatchers.push(proxyDispatcher({ insecure: true })!)

    expect(
      (await deviceApi(target, { insecure: true }).requestCode({ device_label: 'transport' }))
        .device_code,
    ).toBe('transport-code')
    expect(proxy.destinations).toEqual([])
  })

  it('negotiates HTTP/2 with the v8 dispatcher and preserves response headers and body', async () => {
    const server = createSecureServer(certificate)
    let protocol: string | undefined
    server.on('stream', (stream: ServerHttp2Stream) => {
      protocol = stream.session?.alpnProtocol
      stream.respond({ ':status': 200, 'content-type': 'application/json' })
      stream.end(
        JSON.stringify({
          device_code: 'h2-code',
          user_code: 'H2',
          verification_uri: 'https://example.com/verify',
        }),
      )
    })
    const target = await listen(server, true)
    const { deviceApi } = await import('../auth/device-api')
    const { proxyDispatcher } = await import('./proxy')
    dispatchers.push(proxyDispatcher({ insecure: true })!)

    expect(
      (await deviceApi(target, { insecure: true }).requestCode({ device_label: 'transport' }))
        .device_code,
    ).toBe('h2-code')
    expect(protocol).toBe('h2')
  })

  it('rejects an untrusted TLS certificate unless insecure is enabled', async () => {
    const target = await deviceServer(true)
    const { deviceApi } = await import('../auth/device-api')
    const { proxyDispatcher } = await import('./proxy')
    dispatchers.push(proxyDispatcher({ insecure: true })!)

    await expect(
      deviceApi(target, { insecure: false }).requestCode({ device_label: 'transport' }),
    ).rejects.toMatchObject({
      code: 'network_connection',
    })
    expect(
      (await deviceApi(target, { insecure: true }).requestCode({ device_label: 'transport' }))
        .device_code,
    ).toBe('transport-code')
  })
})
