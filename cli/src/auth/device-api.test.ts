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

// Answers every request and records the paths it was asked for, in order.
async function recordingServer<T>(
  answer: (path: string) => { status: number; type?: string; body: string },
  fn: (baseUrl: string, paths: string[]) => Promise<T>,
): Promise<T> {
  const paths: string[] = []
  const server = createServer((req, res) => {
    paths.push(req.url ?? '')
    const { status, type = 'application/json', body } = answer(req.url ?? '')
    res.writeHead(status, { 'content-type': type })
    res.end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as AddressInfo
  try {
    return await fn(`http://127.0.0.1:${port}`, paths)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    )
  }
}

it('polls the standard route and maps access_token and expires_in', async () => {
  const mock = await startMock({ pendingPolls: 1 })
  mocks.push(mock)
  const api = deviceApi(mock.url, { insecure: true })
  await expect(api.pollOnce({ device_code: 'dc' })).resolves.toEqual({ status: 'pending' })

  const before = Date.now()
  const result = await api.pollOnce({ device_code: 'dc' })
  if (result.status !== 'approved') throw new Error(`expected approved, got ${result.status}`)
  expect(result.success.token).toBe('dfoa_test')
  expect(result.success).not.toHaveProperty('access_token')
  expect(result.success.account?.email).toBe('tester@dify.ai')
  const expiresAt = Date.parse(result.success.expires_at ?? '')
  expect(expiresAt).toBeGreaterThan(before + 7_000_000_000)
})

it.each(['legacy-token-route', 'legacy-token-route-html-404'] as const)(
  '%s: the first poll falls back to the legacy route and finishes',
  async (scenario) => {
    const mock = await startMock({ scenario })
    mocks.push(mock)
    const api = deviceApi(mock.url, { insecure: true })
    const result = await api.pollOnce({ device_code: 'dc' })
    if (result.status !== 'approved') throw new Error(`expected approved, got ${result.status}`)
    expect(result.success.token).toBe('dfoa_test')
  },
)

it('stays on the legacy route after one fallback', async () => {
  await recordingServer(
    (path) =>
      path === STANDARD_PATH
        ? { status: 404, body: '{}' }
        : { status: 400, body: JSON.stringify({ error: 'authorization_pending' }) },
    async (baseUrl, paths) => {
      const api = deviceApi(baseUrl, { insecure: true })
      await api.pollOnce({ device_code: 'dc' })
      await api.pollOnce({ device_code: 'dc' })
      expect(paths).toEqual([STANDARD_PATH, LEGACY_PATH, LEGACY_PATH])
    },
  )
})

it.each([
  ['authorization_pending', 'pending'],
  ['slow_down', 'slow_down'],
  ['access_denied', 'denied'],
  ['expired_token', 'expired'],
])('a 400 %s never switches routes', async (error, status) => {
  await recordingServer(
    () => ({ status: 400, body: JSON.stringify({ error }) }),
    async (baseUrl, paths) => {
      const api = deviceApi(baseUrl, { insecure: true })
      await expect(api.pollOnce({ device_code: 'dc' })).resolves.toEqual({ status })
      expect(paths).toEqual([STANDARD_PATH])
    },
  )
})

it.each([500, 502, 503])('a %s never switches routes', async (status) => {
  await recordingServer(
    () => ({ status, type: 'text/html', body: '<html>bad gateway</html>' }),
    async (baseUrl, paths) => {
      const api = deviceApi(baseUrl, { insecure: true })
      await expect(api.pollOnce({ device_code: 'dc' })).resolves.toEqual({ status: 'retry_5xx' })
      expect(paths).toEqual([STANDARD_PATH])
    },
  )
})

it('a network error never switches routes', async () => {
  const mock = await startMock()
  const { port } = mock
  await mock.stop()
  const api = deviceApi(`http://127.0.0.1:${port}`, { insecure: true })
  await expect(api.pollOnce({ device_code: 'dc' })).rejects.toMatchObject({
    code: 'network_connection',
    message: expect.stringContaining(STANDARD_PATH),
  })
})

it('throws on an unknown future poll error without switching routes or looping', async () => {
  await recordingServer(
    () => ({ status: 400, body: JSON.stringify({ error: 'urn:x:future_error' }) }),
    async (baseUrl, paths) => {
      const api = deviceApi(baseUrl, { insecure: true })
      await expect(api.pollOnce({ device_code: 'dc' })).rejects.toMatchObject({
        code: 'unknown',
        message: 'unknown poll error "urn:x:future_error"',
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

it('sends the standard poll as a form body', async () => {
  const bodies: string[] = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      bodies.push(`${req.headers['content-type']}|${raw}`)
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'authorization_pending' }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as AddressInfo
  try {
    const api = deviceApi(`http://127.0.0.1:${port}`, { insecure: true })
    await api.pollOnce({ device_code: 'dc 1' })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  expect(bodies).toEqual([
    'application/x-www-form-urlencoded|grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code&device_code=dc+1&client_id=difyctl',
  ])
})

it('gives invalid_client (401) and unsupported_client the same error', async () => {
  const mock = await startMock()
  mocks.push(mock)
  const api = deviceApi(mock.url, { insecure: true })
  const expected = { code: 'unknown', message: 'this Dify host does not accept the difyctl client' }
  await expect(api.pollOnce({ client_id: 'other', device_code: 'dc' })).rejects.toMatchObject(
    expected,
  )

  await recordingServer(
    () => ({ status: 400, body: JSON.stringify({ error: 'unsupported_client' }) }),
    async (baseUrl) => {
      await expect(
        deviceApi(baseUrl, { insecure: true }).pollOnce({ device_code: 'dc' }),
      ).rejects.toMatchObject(expected)
    },
  )
})

it('keeps verification_uri_complete only when it is a non-empty string', async () => {
  const code = (extra: Record<string, unknown>) => ({
    device_code: 'dc',
    user_code: 'UC',
    verification_uri: 'https://x/device',
    expires_in: 600,
    interval: 1,
    ...extra,
  })
  const cases: [Record<string, unknown>, string | undefined][] = [
    [
      { verification_uri_complete: 'https://x/device?user_code=UC' },
      'https://x/device?user_code=UC',
    ],
    [{ verification_uri_complete: '' }, undefined],
    [{ verification_uri_complete: 42 }, undefined],
    [{}, undefined],
  ]
  for (const [extra, expected] of cases) {
    await recordingServer(
      () => ({ status: 200, body: JSON.stringify(code(extra)) }),
      async (baseUrl) => {
        const got = await deviceApi(baseUrl, { insecure: true }).requestCode({ device_label: 't' })
        expect(got.verification_uri_complete).toBe(expected)
      },
    )
  }
})
