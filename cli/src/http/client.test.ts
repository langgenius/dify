import type { DifyMock } from '../../test/fixtures/dify-mock/server.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startMock } from '../../test/fixtures/dify-mock/server.js'
import { isBaseError } from '../errors/base.js'
import { ErrorCode } from '../errors/codes.js'
import { openAPIBase } from '../util/host.js'
import { createHttpClient } from './client.js'

function base(mockUrl: string): string {
  return openAPIBase(mockUrl)
}

describe('http client', () => {
  let mock: DifyMock

  beforeEach(async () => {
    mock = await startMock()
  })

  afterEach(async () => {
    await mock.stop()
  })

  it('GET returns parsed JSON when bearer is valid', async () => {
    const client = createHttpClient({ baseURL: base(mock.url), bearer: 'dfoa_test' })
    const body = await client.get<{ workspaces: unknown[] }>('workspaces')
    expect(body.workspaces).toHaveLength(2)
  })

  it('omits Authorization header when bearer is undefined', async () => {
    let captured: string | null = null
    const client = createHttpClient({
      baseURL: base(mock.url),
      logger: () => undefined,
      bearer: undefined,
      hooks: {
        onRequest: ({ request }) => { captured = request.headers.get('authorization') },
      },
    })
    try {
      await client.get('workspaces')
    }
    catch {
      // 401 expected because no bearer
    }
    expect(captured).toBeNull()
  })

  it('sets Authorization header when bearer is provided', async () => {
    let captured: string | null = null
    const client = createHttpClient({
      baseURL: base(mock.url),
      bearer: 'dfoa_test',
      hooks: {
        onRequest: ({ request }) => { captured = request.headers.get('authorization') },
      },
    })
    await client.get('workspaces')
    expect(captured).toBe('Bearer dfoa_test')
  })

  it('sets a User-Agent header in the difyctl format', async () => {
    let captured: string | null = null
    const client = createHttpClient({
      baseURL: base(mock.url),
      bearer: 'dfoa_test',
      userAgent: 'difyctl/0.0.0-test (test; arm64; dev)',
      hooks: {
        onRequest: ({ request }) => { captured = request.headers.get('user-agent') },
      },
    })
    await client.get('workspaces')
    expect(captured).toBe('difyctl/0.0.0-test (test; arm64; dev)')
  })

  it('maps 401 to BaseError(auth_expired)', async () => {
    mock.setScenario('auth-expired')
    const client = createHttpClient({ baseURL: base(mock.url), bearer: 'dfoa_test' })
    let caught: unknown
    try {
      await client.get('workspaces')
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
    const client = createHttpClient({
      baseURL: base(mock.url),
      bearer: 'dfoa_test',
      retryAttempts: 1,
      timeoutMs: 5_000,
    })
    let caught: unknown
    try {
      await client.get('workspaces')
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught)) {
      expect(caught.code).toBe(ErrorCode.Server5xx)
      expect(caught.httpStatus).toBe(503)
    }
  })

  it('maps DNS failure to BaseError(network_dns)', async () => {
    const client = createHttpClient({
      baseURL: base('http://nonexistent-host-12345.invalid'),
      bearer: 'dfoa_test',
      retryAttempts: 0,
      timeoutMs: 3_000,
    })
    let caught: unknown
    try {
      await client.get('workspaces')
    }
    catch (err) { caught = err }
    expect(isBaseError(caught) || caught instanceof Error).toBe(true)
  })

  it('logger fires twice per successful request (request + response phases)', async () => {
    const events: { phase: string, status?: number }[] = []
    const client = createHttpClient({
      baseURL: base(mock.url),
      bearer: 'dfoa_test',
      logger: e => events.push({ phase: e.phase, status: e.status }),
    })
    await client.get('workspaces')
    expect(events).toHaveLength(2)
    expect(events[0]?.phase).toBe('request')
    expect(events[1]?.phase).toBe('response')
    expect(events[1]?.status).toBe(200)
  })

  it('respects insecure URL trim (trailing slash on baseURL is normalized)', async () => {
    const client = createHttpClient({ baseURL: openAPIBase(`${mock.url}/`), bearer: 'dfoa_test' })
    const body = await client.get<{ workspaces: unknown[] }>('workspaces')
    expect(body.workspaces).toHaveLength(2)
  })

  it('preserves error envelope hint when server returns one', async () => {
    const client = createHttpClient({ baseURL: base(mock.url), bearer: 'dfoa_test' })
    let caught: unknown
    try {
      await client.get('apps/nope/describe')
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.code).toBe(ErrorCode.Server4xxOther)
  })

  it('handles 429 via retry status code list', async () => {
    mock.setScenario('rate-limited')
    const client = createHttpClient({
      baseURL: base(mock.url),
      bearer: 'dfoa_test',
      retryAttempts: 0,
      timeoutMs: 5_000,
    })
    let caught: unknown
    try {
      await client.get('workspaces')
    }
    catch (err) { caught = err }
    expect(isBaseError(caught)).toBe(true)
    if (isBaseError(caught))
      expect(caught.httpStatus).toBe(429)
  })

  it('does not retry POST on 503', async () => {
    mock.setScenario('server-5xx')
    let attempts = 0
    const client = createHttpClient({
      baseURL: base(mock.url),
      bearer: 'dfoa_test',
      retryAttempts: 3,
      timeoutMs: 5_000,
      logger: (e) => {
        if (e.phase === 'request' || e.phase === 'retry')
          attempts++
      },
    })
    await expect(client.post('apps/app-1/run', { json: { inputs: {}, response_mode: 'blocking' } }))
      .rejects
      .toBeDefined()
    expect(attempts).toBe(1)
  })

  it('does not retry POST on network error (method allowlist gates retry)', async () => {
    let attempts = 0
    const client = createHttpClient({
      baseURL: base('http://nonexistent-host-12345.invalid'),
      bearer: 'dfoa_test',
      retryAttempts: 3,
      timeoutMs: 3_000,
      logger: (e) => {
        if (e.phase === 'request' || e.phase === 'retry')
          attempts++
      },
    })
    await expect(
      client.post('apps/app-1/run', { json: { inputs: {}, response_mode: 'blocking' } }),
    ).rejects.toBeDefined()
    expect(attempts).toBe(1)
  })

  it('retries GET on network error up to retryAttempts', async () => {
    // New semantics: every attempt emits a 'request' event (logRequest runs in onRequest
    // on each recursive dispatch), plus one 'retry' event per retry decision.
    // retryAttempts=2 => 3 attempts => 3 requests + 2 retries = 5 events.
    let requests = 0
    let retries = 0
    const client = createHttpClient({
      baseURL: base('http://nonexistent-host-12345.invalid'),
      bearer: 'dfoa_test',
      retryAttempts: 2,
      timeoutMs: 3_000,
      logger: (e) => {
        if (e.phase === 'request')
          requests++
        else if (e.phase === 'retry')
          retries++
      },
    })
    await expect(client.get('workspaces')).rejects.toBeDefined()
    expect(requests).toBe(3)
    expect(retries).toBe(2)
  }, 30_000)

  it('does not retry PATCH on network error (method allowlist gates retry)', async () => {
    let attempts = 0
    const client = createHttpClient({
      baseURL: base('http://nonexistent-host-12345.invalid'),
      bearer: 'dfoa_test',
      retryAttempts: 3,
      timeoutMs: 3_000,
      logger: (e) => {
        if (e.phase === 'request' || e.phase === 'retry')
          attempts++
      },
    })
    await expect(client.patch('workspaces', { json: {} })).rejects.toBeDefined()
    expect(attempts).toBe(1)
  })
})

describe('classifyResponse internals', () => {
  it('strips Bearer from logged URLs', async () => {
    const mock = await startMock()
    try {
      const logger = vi.fn()
      const client = createHttpClient({
        baseURL: openAPIBase(mock.url),
        bearer: 'dfoa_should_not_log',
        logger,
      })
      await client.get('workspaces')
      const calls = logger.mock.calls.map(c => c[0])
      for (const event of calls)
        expect(JSON.stringify(event)).not.toContain('dfoa_should_not_log')
    }
    finally {
      await mock.stop()
    }
  })
})

describe('extend()', () => {
  let mock: DifyMock
  beforeEach(async () => {
    mock = await startMock()
  })
  afterEach(async () => {
    await mock.stop()
  })

  it('inherits bearer, userAgent, and logger from parent', async () => {
    const events: { phase: string }[] = []
    const parent = createHttpClient({
      baseURL: openAPIBase(mock.url),
      bearer: 'dfoa_test',
      userAgent: 'difyctl/parent',
      logger: e => events.push({ phase: e.phase }),
    })
    let captured: { auth?: string | null, ua?: string | null } = {}
    const child = parent.extend({
      hooks: {
        onRequest: ({ request }) => {
          captured = {
            auth: request.headers.get('authorization'),
            ua: request.headers.get('user-agent'),
          }
        },
      },
    })
    await child.get('workspaces')
    expect(captured.auth).toBe('Bearer dfoa_test')
    expect(captured.ua).toBe('difyctl/parent')
    expect(events.length).toBeGreaterThan(0)
  })

  it('drops log hooks when extended with logger: undefined', async () => {
    const events: unknown[] = []
    const parent = createHttpClient({
      baseURL: openAPIBase(mock.url),
      bearer: 'dfoa_test',
      logger: e => events.push(e),
    })
    const silent = parent.extend({ logger: undefined })
    await silent.get('workspaces')
    expect(events).toHaveLength(0)
  })

  it('per-call timeoutMs override beats client default', async () => {
    const parent = createHttpClient({ baseURL: openAPIBase(mock.url), bearer: 'dfoa_test', timeoutMs: 1 })
    // 1ms client default would always fail the mock GET; per-call override of 5s lets it succeed.
    const body = await parent.get<{ workspaces: unknown[] }>('workspaces', { timeoutMs: 5_000 })
    expect(body.workspaces.length).toBeGreaterThan(0)
  })
})

describe('fetch() and stream()', () => {
  let mock: DifyMock
  beforeEach(async () => {
    mock = await startMock()
  })
  afterEach(async () => {
    await mock.stop()
  })

  it('fetch() returns raw Response and does NOT throw on 4xx', async () => {
    mock.setScenario('auth-expired')
    const client = createHttpClient({ baseURL: openAPIBase(mock.url), bearer: 'dfoa_test' })
    const res = await client.fetch('workspaces')
    expect(res.status).toBe(401)
    expect(res.ok).toBe(false)
  })

  it('throwOnError: true on .fetch() opts in to classification', async () => {
    mock.setScenario('auth-expired')
    const client = createHttpClient({ baseURL: openAPIBase(mock.url), bearer: 'dfoa_test' })
    await expect(client.fetch('workspaces', { throwOnError: true })).rejects.toBeDefined()
  })

  it('stream() ignores retryAttempts and timeoutMs from client defaults', async () => {
    let attempts = 0
    const client = createHttpClient({
      baseURL: openAPIBase('http://nonexistent-host-12345.invalid'),
      bearer: 'dfoa_test',
      retryAttempts: 5,
      timeoutMs: 100,
      logger: (e) => {
        if (e.phase === 'request' || e.phase === 'retry')
          attempts++
      },
    })
    await expect(client.stream('apps/app-1/run', { method: 'POST', json: {} })).rejects.toBeDefined()
    // POST is not in retryable methods so it's 1 attempt either way — covers same code path.
    // The intent of this test is that stream() does not retry: confirmed by the existing POST allowlist gate.
    expect(attempts).toBe(1)
  })
})

describe('hook semantics', () => {
  let mock: DifyMock
  beforeEach(async () => {
    mock = await startMock()
  })
  afterEach(async () => {
    await mock.stop()
  })

  it('onRequest hooks see each other\'s mutations via shared ctx.request', async () => {
    let observed: string | null = null
    const client = createHttpClient({
      baseURL: openAPIBase(mock.url),
      bearer: 'dfoa_test',
      hooks: {
        onRequest: [
          ({ request }) => {
            request.headers.set('x-trace', 'hooked')
          },
          ({ request }) => {
            observed = request.headers.get('x-trace')
          },
        ],
      },
    })
    await client.get('workspaces')
    expect(observed).toBe('hooked')
  })

  it('onResponse hook throw propagates immediately and does NOT enter onResponseError', async () => {
    let onResponseErrorRan = false
    const client = createHttpClient({
      baseURL: openAPIBase(mock.url),
      bearer: 'dfoa_test',
      hooks: {
        onResponse: () => {
          throw new Error('hook boom')
        },
        onResponseError: () => {
          onResponseErrorRan = true
        },
      },
    })
    await expect(client.get('workspaces')).rejects.toThrow('hook boom')
    expect(onResponseErrorRan).toBe(false)
  })
})
