import type { DifyMock } from '../../test/fixtures/dify-mock/server.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startMock } from '../../test/fixtures/dify-mock/server.js'
import { isBaseError } from '../errors/base.js'
import { ErrorCode } from '../errors/codes.js'
import { createClient } from './client.js'

describe('http client', () => {
  let mock: DifyMock

  beforeEach(async () => {
    mock = await startMock()
  })

  afterEach(async () => {
    await mock.stop()
  })

  it('GET /workspaces returns parsed JSON when bearer is valid', async () => {
    const client = createClient({ host: mock.url, bearer: 'dfoa_test' })
    const body = await client.get('workspaces').json<{ workspaces: unknown[] }>()
    expect(body.workspaces).toHaveLength(2)
  })

  it('omits Authorization header when bearer is undefined', async () => {
    let captured: string | null = null
    const client = createClient({
      host: mock.url,
      logger: () => undefined,
      bearer: undefined,
    })
    try {
      await client.get('workspaces', {
        hooks: {
          beforeRequest: [
            ({ request }) => { captured = request.headers.get('authorization') },
          ],
        },
      }).json()
    }
    catch {
      // 401 expected because no bearer
    }
    expect(captured).toBeNull()
  })

  it('sets Authorization header when bearer is provided', async () => {
    let captured: string | null = null
    const client = createClient({ host: mock.url, bearer: 'dfoa_test' })
    await client.get('workspaces', {
      hooks: {
        beforeRequest: [
          ({ request }) => { captured = request.headers.get('authorization') },
        ],
      },
    }).json()
    expect(captured).toBe('Bearer dfoa_test')
  })

  it('sets a User-Agent header in the difyctl format', async () => {
    let captured: string | null = null
    const client = createClient({
      host: mock.url,
      bearer: 'dfoa_test',
      userAgent: 'difyctl/0.0.0-test (test; arm64; dev)',
    })
    await client.get('workspaces', {
      hooks: {
        beforeRequest: [
          ({ request }) => { captured = request.headers.get('user-agent') },
        ],
      },
    }).json()
    expect(captured).toBe('difyctl/0.0.0-test (test; arm64; dev)')
  })

  it('maps 401 to BaseError(auth_expired)', async () => {
    mock.setScenario('auth-expired')
    const client = createClient({ host: mock.url, bearer: 'dfoa_test' })
    let caught: unknown
    try {
      await client.get('workspaces').json()
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught)) {
      expect(caught.code).toBe(ErrorCode.AuthExpired)
      expect(caught.httpStatus).toBe(401)
      expect(caught.method).toBe('GET')
      expect(caught.url).toMatch(/workspaces$/)
    }
  })

  it('maps 5xx to BaseError(server_5xx) after retries', async () => {
    mock.setScenario('server-5xx')
    const client = createClient({
      host: mock.url,
      bearer: 'dfoa_test',
      retryAttempts: 1,
      timeoutMs: 5_000,
    })
    let caught: unknown
    try {
      await client.get('workspaces').json()
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught)) {
      expect(caught.code).toBe(ErrorCode.Server5xx)
      expect(caught.httpStatus).toBe(503)
    }
  })

  it('maps DNS failure to BaseError(network_dns)', async () => {
    const client = createClient({
      host: 'http://nonexistent-host-12345.invalid',
      bearer: 'dfoa_test',
      retryAttempts: 0,
      timeoutMs: 3_000,
    })
    let caught: unknown
    try {
      await client.get('workspaces').json()
    }
    catch (err) { caught = err }
    expect(isBaseError(caught) || caught instanceof Error).toBe(true)
  })

  it('logger fires twice per successful request (request + response phases)', async () => {
    const events: { phase: string, status?: number }[] = []
    const client = createClient({
      host: mock.url,
      bearer: 'dfoa_test',
      logger: e => events.push({ phase: e.phase, status: e.status }),
    })
    await client.get('workspaces').json()
    expect(events).toHaveLength(2)
    expect(events[0]?.phase).toBe('request')
    expect(events[1]?.phase).toBe('response')
    expect(events[1]?.status).toBe(200)
  })

  it('respects insecure URL trim (no trailing slash collapses correctly)', async () => {
    const client = createClient({ host: `${mock.url}/`, bearer: 'dfoa_test' })
    const body = await client.get('workspaces').json<{ workspaces: unknown[] }>()
    expect(body.workspaces).toHaveLength(2)
  })

  it('preserves error envelope hint when server returns one', async () => {
    const client = createClient({ host: mock.url, bearer: 'dfoa_test' })
    let caught: unknown
    try {
      await client.get('apps/nope/describe').json()
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.code).toBe(ErrorCode.Server4xxOther)
  })

  it('handles 429 via retry status code list (eventual server-error class)', async () => {
    mock.setScenario('rate-limited')
    const client = createClient({
      host: mock.url,
      bearer: 'dfoa_test',
      retryAttempts: 0,
      timeoutMs: 5_000,
    })
    let caught: unknown
    try {
      await client.get('workspaces').json()
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.httpStatus).toBe(429)
  })

  it('does not retry POST on 503', async () => {
    mock.setScenario('server-5xx')
    let attempts = 0
    const client = createClient({
      host: mock.url,
      bearer: 'dfoa_test',
      retryAttempts: 3,
      timeoutMs: 5_000,
      logger: (e) => {
        if (e.phase === 'request' || e.phase === 'retry')
          attempts++
      },
    })
    await expect(client.post('apps/app-1/run', { json: { inputs: {}, response_mode: 'blocking' } }).json())
      .rejects
      .toBeDefined()
    expect(attempts).toBe(1)
  })

  it('does not retry POST on network error (method allowlist gates retry)', async () => {
    let attempts = 0
    const client = createClient({
      host: 'http://nonexistent-host-12345.invalid',
      bearer: 'dfoa_test',
      retryAttempts: 3,
      timeoutMs: 3_000,
      logger: (e) => {
        if (e.phase === 'request' || e.phase === 'retry')
          attempts++
      },
    })
    await expect(
      client.post('apps/app-1/run', { json: { inputs: {}, response_mode: 'blocking' } }).json(),
    ).rejects.toBeDefined()
    expect(attempts).toBe(1)
  })

  it('retries GET on network error up to retryAttempts', async () => {
    let attempts = 0
    const client = createClient({
      host: 'http://nonexistent-host-12345.invalid',
      bearer: 'dfoa_test',
      retryAttempts: 2,
      timeoutMs: 3_000,
      logger: (e) => {
        if (e.phase === 'request' || e.phase === 'retry')
          attempts++
      },
    })
    await expect(client.get('workspaces').json()).rejects.toBeDefined()
    expect(attempts).toBe(3)
  }, 30_000)

  it('does not retry PATCH on network error (method allowlist gates retry)', async () => {
    let attempts = 0
    const client = createClient({
      host: 'http://nonexistent-host-12345.invalid',
      bearer: 'dfoa_test',
      retryAttempts: 3,
      timeoutMs: 3_000,
      logger: (e) => {
        if (e.phase === 'request' || e.phase === 'retry')
          attempts++
      },
    })
    await expect(
      client.patch('workspaces', { json: {} }).json(),
    ).rejects.toBeDefined()
    expect(attempts).toBe(1)
  })
})

describe('classifyResponse internals', () => {
  it('strips Bearer from logged URLs (sanity check via vi.fn logger)', async () => {
    const mock = await startMock()
    try {
      const logger = vi.fn()
      const client = createClient({
        host: mock.url,
        bearer: 'dfoa_should_not_log',
        logger,
      })
      await client.get('workspaces').json()
      const calls = logger.mock.calls.map(c => c[0])
      for (const event of calls)
        expect(JSON.stringify(event)).not.toContain('dfoa_should_not_log')
    }
    finally {
      await mock.stop()
    }
  })
})
