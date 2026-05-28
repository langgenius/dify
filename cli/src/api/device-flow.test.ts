import type { AddressInfo } from 'node:net'
import type { DifyMock } from '../../test/fixtures/dify-mock/server.js'
import type { CodeResponse } from './oauth-device.js'
import { Buffer } from 'node:buffer'
import * as http from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startMock } from '../../test/fixtures/dify-mock/server.js'
import { isBaseError } from '../errors/base.js'
import { ErrorCode } from '../errors/codes.js'
import { createClient } from '../http/client.js'
import { DEFAULT_CLIENT_ID, DeviceFlowApi } from './oauth-device.js'

type StubServer = {
  url: string
  stop: () => Promise<void>
}

function startStub(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<StubServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        stop: () => new Promise<void>((res, rej) => server.close(err => err ? rej(err) : res())),
      })
    })
    server.on('error', reject)
  })
}

function jsonStub(status: number, body: unknown): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (_req, res) => {
    const payload = JSON.stringify(body)
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
    res.end(payload)
  }
}

function makeApi(mock: DifyMock): DeviceFlowApi {
  return new DeviceFlowApi(createClient({ host: mock.url }))
}

describe('DeviceFlowApi.requestCode', () => {
  let mock: DifyMock

  beforeEach(async () => {
    mock = await startMock()
  })

  afterEach(async () => {
    await mock.stop()
  })

  it('POSTs to /openapi/v1/oauth/device/code with default client_id', async () => {
    const api = makeApi(mock)
    const out = await api.requestCode({ device_label: 'difyctl on host' })
    expect(out.user_code).toBe('ABCD-1234')
    expect(out.device_code).toBeDefined()
    expect(DEFAULT_CLIENT_ID).toBe('difyctl')
  })

  it('strips trailing slash from host', async () => {
    const api = new DeviceFlowApi(createClient({ host: `${mock.url}/` }))
    const out = await api.requestCode({ device_label: 'l' })
    expect(out.device_code).toBeDefined()
  })

  it('throws BaseError(unsupported_endpoint) on 404', async () => {
    let stub: StubServer | undefined
    try {
      stub = await startStub(jsonStub(404, {}))
      const api = new DeviceFlowApi(createClient({ host: stub.url }))
      let caught: unknown
      try {
        await api.requestCode({ device_label: 'l' })
      }
      catch (e) {
        caught = e
      }
      expect(isBaseError(caught)).toBe(true)
      if (isBaseError(caught))
        expect(caught.code).toBe(ErrorCode.UnsupportedEndpoint)
    }
    finally {
      await stub?.stop()
    }
  })

  it('rejects empty device_label', async () => {
    const api = makeApi(mock)
    await expect(api.requestCode({ device_label: '' })).rejects.toThrow(/device_label/)
  })
})

describe('DeviceFlowApi.pollOnce', () => {
  let mock: DifyMock

  beforeEach(async () => {
    mock = await startMock()
  })

  afterEach(async () => {
    await mock.stop()
  })

  it('returns approved with token on 200', async () => {
    const api = makeApi(mock)
    const r = await api.pollOnce({ device_code: 'devcode-1' })
    expect(r.status).toBe('approved')
    if (r.status === 'approved')
      expect(r.success.token).toBe('dfoa_test')
  })

  it('maps authorization_pending to pending', async () => {
    let stub: StubServer | undefined
    try {
      stub = await startStub(jsonStub(400, { error: 'authorization_pending' }))
      const api = new DeviceFlowApi(createClient({ host: stub.url }))
      const r = await api.pollOnce({ device_code: 'dc' })
      expect(r.status).toBe('pending')
    }
    finally {
      await stub?.stop()
    }
  })

  it('maps slow_down to slow_down', async () => {
    mock.setScenario('slow-down')
    const api = makeApi(mock)
    const r = await api.pollOnce({ device_code: 'devcode-1' })
    expect(r.status).toBe('slow_down')
  })

  it('maps expired_token to expired', async () => {
    mock.setScenario('expired')
    const api = makeApi(mock)
    const r = await api.pollOnce({ device_code: 'devcode-1' })
    expect(r.status).toBe('expired')
  })

  it('maps access_denied to denied', async () => {
    mock.setScenario('denied')
    const api = makeApi(mock)
    const r = await api.pollOnce({ device_code: 'devcode-1' })
    expect(r.status).toBe('denied')
  })

  it('throws BaseError(unsupported_endpoint) on 404', async () => {
    let stub: StubServer | undefined
    try {
      stub = await startStub(jsonStub(404, {}))
      const api = new DeviceFlowApi(createClient({ host: stub.url }))
      await expect(api.pollOnce({ device_code: 'dc' })).rejects.toThrow(/device flow/i)
    }
    finally {
      await stub?.stop()
    }
  })

  it('signals retryable on 5xx', async () => {
    mock.setScenario('server-5xx')
    const api = makeApi(mock)
    const r = await api.pollOnce({ device_code: 'devcode-1' })
    expect(r.status).toBe('retry_5xx')
  })

  it('rejects 200 with empty body', async () => {
    let stub: StubServer | undefined
    try {
      stub = await startStub(jsonStub(200, {}))
      const api = new DeviceFlowApi(createClient({ host: stub.url }))
      await expect(api.pollOnce({ device_code: 'dc' })).rejects.toThrow(/no OAuth envelope|token/i)
    }
    finally {
      await stub?.stop()
    }
  })

  it('rejects unknown error code', async () => {
    let stub: StubServer | undefined
    try {
      stub = await startStub(jsonStub(400, { error: 'something_else' }))
      const api = new DeviceFlowApi(createClient({ host: stub.url }))
      await expect(api.pollOnce({ device_code: 'dc' })).rejects.toThrow(/unknown poll error/)
    }
    finally {
      await stub?.stop()
    }
  })

  it('preserves dfoe_ token kind in approved branch', async () => {
    mock.setScenario('sso')
    const api = makeApi(mock)
    const r = await api.pollOnce({ device_code: 'devcode-1' })
    expect(r.status).toBe('approved')
    if (r.status === 'approved') {
      expect(r.success.token).toBe('dfoe_test')
      expect(r.success.subject_type).toBe('external_sso')
    }
  })
})

describe('DeviceFlowApi types', () => {
  it('CodeResponse has required fields', () => {
    const r: CodeResponse = {
      device_code: 'd',
      user_code: 'u',
      verification_uri: 'v',
      expires_in: 1,
      interval: 1,
    }
    expect(r.device_code).toBe('d')
  })
})
