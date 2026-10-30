import type { DifyMock } from '@test/fixtures/dify-mock/server'
import type { ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { startMock } from '@test/fixtures/dify-mock/server'
import { afterEach, expect, it } from 'vite-plus/test'
import { deviceApi } from './device-api'

const mocks: DifyMock[] = []
afterEach(async () => {
  for (const m of mocks.splice(0)) await m.stop()
})

// A one-shot raw HTTP server for responses the shared dify-mock has no scenario
// for (an RFC 8628 pending poll, a malformed code response).
async function withServer<T>(
  handler: (res: ServerResponse) => void,
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createServer((_req, res) => handler(res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as AddressInfo
  try {
    return await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    )
  }
}

it('maps a 404 on the code endpoint to a server_error naming the missing feature', async () => {
  const mock = await startMock({ scenario: 'no-device-flow' })
  mocks.push(mock)
  const api = deviceApi(mock.url, { insecure: true })
  await expect(api.requestCode({ device_label: 'test' })).rejects.toMatchObject({
    code: 'server_error',
    message: 'this Dify host does not implement the OAuth device flow',
  })
})

it('maps a non-2xx code response to a server_error carrying the raw body', async () => {
  const mock = await startMock({ scenario: 'server-5xx' })
  mocks.push(mock)
  const api = deviceApi(mock.url, { insecure: true })
  await expect(api.requestCode({ device_label: 'test' })).rejects.toMatchObject({
    code: 'server_error',
    rawResponse: expect.stringContaining('upstream broken'),
  })
})

it('maps an unreachable server to network_connection', async () => {
  const mock = await startMock()
  const { port } = mock
  await mock.stop()
  const api = deviceApi(`http://127.0.0.1:${port}`, { insecure: true })
  await expect(api.requestCode({ device_label: 'test' })).rejects.toMatchObject({
    code: 'network_connection',
  })
})

it('maps the RFC 8628 poll error codes to their statuses', async () => {
  const mock = await startMock({ scenario: 'denied' })
  mocks.push(mock)
  const api = deviceApi(mock.url, { insecure: true })
  await expect(api.pollOnce({ device_code: 'dc' })).resolves.toEqual({ status: 'denied' })

  mock.setScenario('expired')
  await expect(api.pollOnce({ device_code: 'dc' })).resolves.toEqual({ status: 'expired' })

  mock.setScenario('slow-down')
  await expect(api.pollOnce({ device_code: 'dc' })).resolves.toEqual({ status: 'slow_down' })

  mock.setScenario('happy')
  const approved = await api.pollOnce({ device_code: 'dc' })
  expect(approved.status).toBe('approved')
})

it('reports authorization_pending as a pending poll', async () => {
  await withServer(
    (res) => {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'authorization_pending' }))
    },
    async (baseUrl) => {
      const api = deviceApi(baseUrl, { insecure: true })
      await expect(api.pollOnce({ device_code: 'dc' })).resolves.toEqual({ status: 'pending' })
    },
  )
})

it('rejects an incomplete code response without leaking a raw parse error', async () => {
  await withServer(
    (res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ device_code: 'dc' }))
    },
    async (baseUrl) => {
      const api = deviceApi(baseUrl, { insecure: true })
      await expect(api.requestCode({ device_label: 'test' })).rejects.toMatchObject({
        code: 'server_error',
        message: expect.stringContaining('user_code'),
      })
    },
  )
})

it('rejects a non-JSON code response without leaking a raw SyntaxError', async () => {
  await withServer(
    (res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('not json')
    },
    async (baseUrl) => {
      const api = deviceApi(baseUrl, { insecure: true })
      await expect(api.requestCode({ device_label: 'test' })).rejects.toMatchObject({
        code: 'server_error',
      })
    },
  )
})

const STANDARD_PATH = '/openapi/v1/oauth/token'
const LEGACY_PATH = '/openapi/v1/oauth/device/token'
const PENDING = { status: 400, body: JSON.stringify({ error: 'authorization_pending' }) }

// Answers every request and records the paths and bodies it was sent, in order.
async function recordingServer<T>(
  answer: (path: string) => { status: number; type?: string; body: string },
  fn: (baseUrl: string, paths: string[], bodies: string[]) => Promise<T>,
): Promise<T> {
  const paths: string[] = []
  const bodies: string[] = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      paths.push(req.url ?? '')
      bodies.push(`${req.headers['content-type']}|${raw}`)
      const { status, type = 'application/json', body } = answer(req.url ?? '')
      res.writeHead(status, { 'content-type': type })
      res.end(body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as AddressInfo
  try {
    return await fn(`http://127.0.0.1:${port}`, paths, bodies)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    )
  }
}

it('polls the standard route with a form body and maps access_token and expires_in', async () => {
  const approved = { access_token: 'dfoa_x', token_type: 'Bearer', expires_in: 3600 }
  await recordingServer(
    () => ({ status: 200, body: JSON.stringify(approved) }),
    async (baseUrl, paths, bodies) => {
      const before = Date.now()
      const result = await deviceApi(baseUrl, { insecure: true }).pollOnce({ device_code: 'dc 1' })
      if (result.status !== 'approved') throw new Error(`expected approved, got ${result.status}`)
      expect(result.success.token).toBe('dfoa_x')
      expect(Date.parse(result.success.expires_at ?? '')).toBeGreaterThanOrEqual(before + 3_600_000)
      expect(paths).toEqual([STANDARD_PATH])
      expect(bodies).toEqual([
        'application/x-www-form-urlencoded|grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code&device_code=dc+1&client_id=difyctl',
      ])
    },
  )
})

it.each([
  ['JSON', 'application/json', '{}'],
  ['HTML', 'text/html', '<html>404 Not Found</html>'],
])('falls back to the legacy route on a %s 404 and stays there', async (_kind, type, body) => {
  await recordingServer(
    (path) => (path === STANDARD_PATH ? { status: 404, type, body } : PENDING),
    async (baseUrl, paths) => {
      const api = deviceApi(baseUrl, { insecure: true })
      await expect(api.pollOnce({ device_code: 'dc' })).resolves.toEqual({ status: 'pending' })
      await api.pollOnce({ device_code: 'dc' })
      expect(paths).toEqual([STANDARD_PATH, LEGACY_PATH, LEGACY_PATH])
    },
  )
})

it.each([
  [PENDING, 'pending'],
  [{ status: 502, type: 'text/html', body: '<html>bad gateway</html>' }, 'retry_5xx'],
])('a non-404 answer never switches routes (%o)', async (answer, status) => {
  await recordingServer(
    () => answer,
    async (baseUrl, paths) => {
      const api = deviceApi(baseUrl, { insecure: true })
      await expect(api.pollOnce({ device_code: 'dc' })).resolves.toEqual({ status })
      expect(paths).toEqual([STANDARD_PATH])
    },
  )
})

it.each([
  [401, 'invalid_client', 'this Dify host does not accept the difyctl client'],
  [400, 'unsupported_client', 'this Dify host does not accept the difyctl client'],
  [400, 'urn:x:future_error', 'unknown poll error "urn:x:future_error"'],
])('a %s %s fails without switching routes', async (status, error, message) => {
  await recordingServer(
    () => ({ status, body: JSON.stringify({ error }) }),
    async (baseUrl, paths) => {
      const api = deviceApi(baseUrl, { insecure: true })
      await expect(api.pollOnce({ device_code: 'dc' })).rejects.toMatchObject({
        code: 'unknown',
        message,
      })
      expect(paths).toEqual([STANDARD_PATH])
    },
  )
})

it('a 404 on the legacy route is an unsupported device flow', async () => {
  await recordingServer(
    () => ({ status: 404, body: '{}' }),
    async (baseUrl, paths) => {
      const api = deviceApi(baseUrl, { insecure: true })
      await expect(api.pollOnce({ device_code: 'dc' })).rejects.toMatchObject({
        code: 'server_error',
        message: 'this Dify host does not implement the OAuth device flow',
      })
      expect(paths).toEqual([STANDARD_PATH, LEGACY_PATH])
    },
  )
})

it.each(['', 42])('drops a verification_uri_complete of %o', async (complete) => {
  const code = {
    device_code: 'dc',
    user_code: 'UC',
    verification_uri: 'https://x/device',
    verification_uri_complete: complete,
    expires_in: 600,
    interval: 1,
  }
  await recordingServer(
    () => ({ status: 200, body: JSON.stringify(code) }),
    async (baseUrl) => {
      const got = await deviceApi(baseUrl, { insecure: true }).requestCode({ device_label: 't' })
      expect(got).not.toHaveProperty('verification_uri_complete')
    },
  )
})
