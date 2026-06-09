// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('server console oRPC client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    mocks.serverConsoleApiPrefix = undefined
    mocks.headers.mockResolvedValue(new Headers({ cookie: 'access_token=abc; csrf_token=csrf-token' }))
    mocks.cookies.mockResolvedValue({
      get: vi.fn(() => ({ value: 'csrf-token' })),
    })
  })

  it('should resolve server console API URLs only from configured or absolute prefixes', async () => {
    const { resolveServerConsoleApiPrefix, resolveServerConsoleApiUrl } = await import('../server')

    expect(resolveServerConsoleApiPrefix(undefined, '/console/api')).toBeNull()
    expect(resolveServerConsoleApiUrl('/account/profile', undefined, '/console/api')).toBeNull()
    expect(
      resolveServerConsoleApiUrl('/account/profile', 'https://api.example.com/console/api', '/console/api'),
    ).toBe('https://api.example.com/console/api/account/profile')
    expect(
      resolveServerConsoleApiUrl('/account/profile', undefined, 'https://public.example.com/console/api'),
    ).toBe('https://public.example.com/console/api/account/profile')
  })

  it('should build per-request context from Next headers and cookies', async () => {
    const { getServerConsoleClientContext } = await import('../server')

    await expect(getServerConsoleClientContext()).resolves.toEqual({
      cookie: 'access_token=abc; csrf_token=csrf-token',
      csrfToken: 'csrf-token',
    })
  })

  it('should call contracts with forwarded cookies, csrf header, and no-store cache', async () => {
    const { defaultSystemFeatures } = await import('@/features/system-features/config')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(defaultSystemFeatures), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { getServerConsoleClientContext, serverConsoleClient } = await import('../server')

    await serverConsoleClient.systemFeatures.get(undefined, {
      context: await getServerConsoleClientContext(),
    })

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
