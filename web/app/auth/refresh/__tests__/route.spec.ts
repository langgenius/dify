// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  basePath: '',
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
    vi.unstubAllGlobals()
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
    expect(response.headers.get('location')).toBe('/signin?redirect_url=%2Fapps')
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
})
