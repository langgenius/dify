// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  basePath: '',
}))

vi.mock('@/config', () => ({
  API_PREFIX: 'http://localhost:5001/console/api',
  CSRF_COOKIE_NAME: () => 'csrf_token',
  CSRF_HEADER_NAME: 'X-CSRF-Token',
}))

vi.mock('server-only', () => ({}))

vi.mock('@/config/server', () => ({
  SERVER_CONSOLE_API_PREFIX: undefined,
}))

vi.mock('@/utils/var', () => ({
  get basePath() {
    return mocks.basePath
  },
}))

const getSetCookieHeaders = (headers: Headers) => {
  const getSetCookie = Reflect.get(headers, 'getSetCookie')

  if (typeof getSetCookie === 'function') {
    const values: unknown = getSetCookie.call(headers)
    return Array.isArray(values) ? values : []
  }

  const setCookie = headers.get('set-cookie')
  return setCookie ? [setCookie] : []
}

const createRequest = (url: string, cookie?: string) => ({
  url,
  headers: new Headers(cookie ? { cookie } : undefined),
}) as Request

describe('auth refresh route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.unstubAllGlobals()
    mocks.basePath = ''
  })

  it('should refresh cookies and redirect back to the requested path', async () => {
    const headers = new Headers()
    Object.defineProperty(headers, 'getSetCookie', {
      value: () => [
        'access_token=new-access; Path=/; HttpOnly',
        'refresh_token=new-refresh; Path=/; HttpOnly',
      ],
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers,
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('../route')

    const response = await GET(createRequest(
      'http://localhost:3000/auth/refresh?redirect_url=%2Fapps%3Fcategory%3Dworkflow',
      'refresh_token=old-refresh',
    ))

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5001/console/api/refresh-token',
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        headers: expect.any(Headers),
      }),
    )
    const fetchHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers
    expect(fetchHeaders.get('cookie')).toBe('refresh_token=old-refresh')
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/apps?category=workflow')
    expect(getSetCookieHeaders(response.headers)).toEqual([
      'access_token=new-access; Path=/; HttpOnly',
      'refresh_token=new-refresh; Path=/; HttpOnly',
    ])
  })

  it('should redirect to signin when refresh token is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    const { GET } = await import('../route')

    const response = await GET(createRequest(
      'http://localhost:3000/auth/refresh?redirect_url=%2Fapps',
      'refresh_token=expired',
    ))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/signin?redirect_url=%2Fapps')
  })

  it('should ignore cross-origin redirect targets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('../route')

    const response = await GET(createRequest(
      'http://localhost:3000/auth/refresh?redirect_url=https%3A%2F%2Fevil.example',
      'refresh_token=expired',
    ))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/signin?redirect_url=%2F')
  })

  it('should default missing redirect targets to the home path', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    const { GET } = await import('../route')

    const response = await GET(createRequest(
      'http://localhost:3000/auth/refresh',
      'refresh_token=expired',
    ))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/signin?redirect_url=%2F')
  })

  it('should not leak internal request origin when redirecting to signin', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    const { GET } = await import('../route')

    const response = await GET(createRequest(
      'http://internal-service:3000/auth/refresh?redirect_url=%2F',
      'refresh_token=expired',
    ))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/signin?redirect_url=%2F')
  })

  it('should preserve base path when refreshing and redirecting back', async () => {
    mocks.basePath = '/console'
    const headers = new Headers()
    Object.defineProperty(headers, 'getSetCookie', {
      value: () => [
        'access_token=new-access; Path=/console; HttpOnly',
        'refresh_token=new-refresh; Path=/console; HttpOnly',
      ],
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers,
    } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('../route')

    const response = await GET(createRequest(
      'http://localhost:3000/console/auth/refresh?redirect_url=%2Fconsole%2Fapps%3Fcategory%3Dworkflow',
      'refresh_token=old-refresh',
    ))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/console/apps?category=workflow')
    expect(getSetCookieHeaders(response.headers)).toEqual([
      'access_token=new-access; Path=/console; HttpOnly',
      'refresh_token=new-refresh; Path=/console; HttpOnly',
    ])
  })

  it('should fall back to the base path home when base path refresh redirects to itself', async () => {
    mocks.basePath = '/console'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    const { GET } = await import('../route')

    const response = await GET(createRequest(
      'http://localhost:3000/console/auth/refresh?redirect_url=%2Fconsole%2Fauth%2Frefresh',
      'refresh_token=expired',
    ))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/console/signin?redirect_url=%2Fconsole%2F')
  })
})
