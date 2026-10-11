// @vitest-environment node

import { AsyncLocalStorage } from 'node:async_hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  cookies: vi.fn(),
  serverConsoleApiPrefix: undefined as string | undefined,
}))

vi.mock('server-only', () => ({}))

vi.mock('@/config', () => ({
  API_PREFIX: 'http://localhost:5001/console/api',
  CSRF_COOKIE_NAME: () => 'csrf_token',
  CSRF_HEADER_NAME: 'X-CSRF-Token',
}))

vi.mock('@/config/server', () => ({
  get SERVER_CONSOLE_API_PREFIX() {
    return mocks.serverConsoleApiPrefix
  },
}))

vi.mock('@/next/headers', () => ({
  headers: () => mocks.headers(),
  cookies: () => mocks.cookies(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  mocks.serverConsoleApiPrefix = undefined
  mocks.headers.mockResolvedValue(
    new Headers({ cookie: 'access_token=abc; csrf_token=csrf-token' }),
  )
  mocks.cookies.mockResolvedValue({
    get: vi.fn(() => ({ value: 'csrf-token' })),
  })
})

describe('server console oRPC client', () => {
  it('should resolve server console API URLs only from configured or absolute prefixes', async () => {
    const { resolveServerConsoleApiPrefix, resolveServerConsoleApiUrl } = await import('./server')

    expect(resolveServerConsoleApiPrefix(undefined, '/console/api')).toBeNull()
    expect(resolveServerConsoleApiUrl('/account/profile', undefined, '/console/api')).toBeNull()
    expect(
      resolveServerConsoleApiUrl(
        '/account/profile',
        'https://api.example.com/console/api',
        '/console/api',
      ),
    ).toBe('https://api.example.com/console/api/account/profile')
    expect(
      resolveServerConsoleApiUrl(
        '/account/profile',
        undefined,
        'https://public.example.com/console/api',
      ),
    ).toBe('https://public.example.com/console/api/account/profile')
  })

  it('should call contracts with forwarded cookies, csrf header, and no-store cache', async () => {
    const { createSystemFeaturesFixture } = await import('@/test/console/system-features')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(createSystemFeaturesFixture()), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await import('./server')
    const { consoleClient } = await import('@/service/console')

    await consoleClient.systemFeatures.get()

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        cache: 'no-store',
        redirect: 'manual',
      }),
    )
    const request = fetchMock.mock.calls[0]?.[0] as Request
    expect(request.url).toBe('http://localhost:5001/console/api/system-features')
    expect(request.method).toBe('GET')
    expect(request.headers.get('accept')).toBe('application/json')
    expect(request.headers.get('content-type')).toBeNull()
    expect(request.headers.get('cookie')).toBe('access_token=abc; csrf_token=csrf-token')
    expect(request.headers.get('X-CSRF-Token')).toBe('csrf-token')
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('unified Console server identity', () => {
  it('keeps concurrent request identities out of the shared transport', async () => {
    const identities = new AsyncLocalStorage<string>()
    mocks.headers.mockImplementation(
      async () => new Headers({ cookie: `session=${identities.getStore()}` }),
    )
    mocks.cookies.mockImplementation(async () => ({
      get: () => ({ value: identities.getStore() }),
    }))
    const { createSystemFeaturesFixture } = await import('@/test/console/system-features')
    const fetch = vi.fn(async (_request: Request) => Response.json(createSystemFeaturesFixture()))
    vi.stubGlobal('fetch', fetch)
    await import('./server')
    const { consoleClient } = await import('@/service/console')
    await Promise.all(
      ['alice', 'bob'].map((identity) =>
        identities.run(identity, () => consoleClient.systemFeatures.get()),
      ),
    )
    expect(
      fetch.mock.calls.map(([request]) => (request as Request).headers.get('cookie')).sort(),
    ).toEqual(['session=alice', 'session=bob'])
    expect(
      fetch.mock.calls.map(([request]) => (request as Request).headers.get('X-CSRF-Token')).sort(),
    ).toEqual(['alice', 'bob'])
  })

  it('supports anonymous requests and selects the internal host at call time', async () => {
    mocks.headers.mockResolvedValue(new Headers())
    mocks.cookies.mockResolvedValue({ get: () => undefined })
    mocks.serverConsoleApiPrefix = 'https://internal.example/console/api'
    const { createSystemFeaturesFixture } = await import('@/test/console/system-features')
    const fetch = vi.fn(async (_request: Request) => Response.json(createSystemFeaturesFixture()))
    vi.stubGlobal('fetch', fetch)
    await import('./server')
    const { consoleClient } = await import('@/service/console')
    await consoleClient.systemFeatures.get()
    const request = fetch.mock.calls[0]?.[0] as Request
    expect(request.url).toBe('https://internal.example/console/api/system-features')
    expect(request.headers.has('cookie')).toBe(false)
    expect(request.headers.has('X-CSRF-Token')).toBe(false)
  })

  it('uses the same array encoding and forwards the abort signal on the server', async () => {
    mocks.headers.mockResolvedValue(new Headers())
    mocks.cookies.mockResolvedValue({ get: () => undefined })
    const fetch = vi.fn(async (_request: Request) =>
      Response.json({ data: [], has_more: false, limit: 20, page: 1, total: 0 }),
    )
    vi.stubGlobal('fetch', fetch)
    const { consoleClient } = await import('@/service/console')
    const controller = new AbortController()
    await consoleClient.trialApps.byAppId.datasets.get(
      {
        params: { app_id: 'app-1' },
        query: { ids: ['id-1', 'id-2'] },
      },
      { signal: controller.signal },
    )
    const request = fetch.mock.calls[0]![0]
    const url = new URL(request.url)
    expect(url.searchParams.getAll('ids')).toEqual(['id-1', 'id-2'])
    expect(url.searchParams.has('ids[0]')).toBe(false)
    expect(request.signal.aborted).toBe(false)
    controller.abort()
    expect(request.signal.aborted).toBe(true)
  })
})
