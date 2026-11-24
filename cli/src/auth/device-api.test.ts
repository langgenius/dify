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
