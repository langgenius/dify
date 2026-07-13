// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  basePath: '',
  isCloudEdition: false,
}))

vi.mock('@/config', () => ({
  API_PREFIX: 'http://localhost:5001/console/api',
  CSRF_COOKIE_NAME: () => 'csrf_token',
  CSRF_HEADER_NAME: 'X-CSRF-Token',
  get IS_CLOUD_EDITION() {
    return mocks.isCloudEdition
  },
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
    mocks.isCloudEdition = false
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

  it.each([
    ['a protocol-relative URL', '%2F%2Fevil.example'],
    ['a backslash URL', '%2F%5Cevil.example'],
    ['an encoded protocol-relative URL', '%252F%252Fevil.example'],
    ['an HTTP Dify URL', 'http%3A%2F%2Fdocs.dify.ai%2Fapps'],
    ['a Dify URL with a non-standard port', 'https%3A%2F%2Fdocs.dify.ai%3A444%2Fapps'],
    ['a Dify lookalike URL', 'https%3A%2F%2Fdify.ai.evil.example%2Fapps'],
    ['a URL with userinfo', 'https%3A%2F%2Fuser%3Apass%40dify.ai%2Fapps'],
  ])('should use the self-hosted fallback for %s', async (_, redirectUrl) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    const { GET } = await import('../route')

    const response = await GET(
      createRequest(
        `http://localhost:3000/auth/refresh?redirect_url=${redirectUrl}`,
        'refresh_token=expired',
      ),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/signin?redirect_url=%2F')
  })

  it('should reject an absolute redirect that matches an internal proxy origin', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    const { GET } = await import('../route')

    const response = await GET(
      createRequest(
        'http://internal-service:3000/auth/refresh?redirect_url=http%3A%2F%2Finternal-service%3A3000%2Fapps',
        'refresh_token=expired',
      ),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/signin?redirect_url=%2F')
  })

  it('should reject a same-origin absolute redirect whose path starts with two slashes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    const { GET } = await import('../route')

    const response = await GET(
      createRequest(
        'https://cloud.dify.ai/auth/refresh?redirect_url=https%3A%2F%2Fcloud.dify.ai%2F%2Fevil.example',
        'refresh_token=expired',
      ),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/signin?redirect_url=%2F')
  })

  it('should accept a trusted Dify HTTPS redirect and preserve its query and fragment', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
    const { GET } = await import('../route')

    const response = await GET(
      createRequest(
        'http://localhost:3000/auth/refresh?redirect_url=https%3A%2F%2Fdocs.eu.dify.ai%2Fapps%3Fcategory%3Dworkflow%23recent',
        'refresh_token=old-refresh',
      ),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      'https://docs.eu.dify.ai/apps?category=workflow#recent',
    )
  })

  it('should accept a once-encoded legacy internal redirect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
    const { GET } = await import('../route')

    const response = await GET(
      createRequest(
        'http://localhost:3000/auth/refresh?redirect_url=%252Fapps%253Fcategory%253Dworkflow',
        'refresh_token=old-refresh',
      ),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/apps?category=workflow')
  })

  it('should preserve a nested OAuth redirect URI without validating it as the top-level target', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
    const { GET } = await import('../route')
    const redirectUrl = new URLSearchParams({
      redirect_url:
        '/account/oauth/authorize?client_id=client&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback',
    })

    const response = await GET(
      createRequest(
        `http://localhost:3000/auth/refresh?${redirectUrl}`,
        'refresh_token=old-refresh',
      ),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      '/account/oauth/authorize?client_id=client&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback',
    )
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

  it('should use the Cloud home as the fallback after a successful refresh', async () => {
    mocks.isCloudEdition = true
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
    const { GET } = await import('../route')

    const response = await GET(
      createRequest(
        'https://cloud.dify.ai/auth/refresh?redirect_url=https%3A%2F%2Fevil.example',
        'refresh_token=old-refresh',
      ),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://cloud.dify.ai/')
  })

  it('should carry the Cloud fallback through signin when refresh fails', async () => {
    mocks.isCloudEdition = true
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    const { GET } = await import('../route')

    const response = await GET(
      createRequest(
        'https://cloud.dify.ai/auth/refresh?redirect_url=https%3A%2F%2Fevil.example',
        'refresh_token=expired',
      ),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      '/signin?redirect_url=https%3A%2F%2Fcloud.dify.ai%2F',
    )
  })

  it('should use the Cloud home when a trusted absolute target loops back to auth refresh', async () => {
    mocks.isCloudEdition = true
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
    const { GET } = await import('../route')

    const response = await GET(
      createRequest(
        'https://cloud.dify.ai/auth/refresh?redirect_url=https%3A%2F%2Fcloud.dify.ai%2Fauth%2Frefresh',
        'refresh_token=old-refresh',
      ),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://cloud.dify.ai/')
  })

  it.each(['/auth/refresh/', '/auth/%72efresh'])(
    'should fall back after refresh succeeds when %s resolves to auth refresh',
    async (redirectUrl) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
      const { GET } = await import('../route')
      const searchParams = new URLSearchParams({ redirect_url: redirectUrl })

      const response = await GET(
        createRequest(
          `http://localhost:3000/auth/refresh?${searchParams}`,
          'refresh_token=old-refresh',
        ),
      )

      expect(response.status).toBe(303)
      expect(response.headers.get('location')).toBe('/')
    },
  )

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

    const response = await GET(
      createRequest(
        'http://localhost:3000/console/auth/refresh?redirect_url=%2Fconsole%2Fapps%3Fcategory%3Dworkflow',
        'refresh_token=old-refresh',
      ),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/console/apps?category=workflow')
    expect(getSetCookieHeaders(response.headers)).toEqual([
      'access_token=new-access; Path=/console; HttpOnly',
      'refresh_token=new-refresh; Path=/console; HttpOnly',
    ])
  })

  it('should add the base path to an unprefixed internal target after refresh succeeds', async () => {
    mocks.basePath = '/console'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
    const { GET } = await import('../route')

    const response = await GET(
      createRequest(
        'http://localhost:3000/console/auth/refresh?redirect_url=%2Fapps',
        'refresh_token=old-refresh',
      ),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/console/apps')
  })

  it('should add the base path to the signin redirect target after refresh fails', async () => {
    mocks.basePath = '/console'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    const { GET } = await import('../route')

    const response = await GET(
      createRequest(
        'http://localhost:3000/console/auth/refresh?redirect_url=%2Fapps',
        'refresh_token=expired',
      ),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/console/signin?redirect_url=%2Fconsole%2Fapps')
  })

  it('should fall back to the base path home when base path refresh redirects to itself', async () => {
    mocks.basePath = '/console'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    const { GET } = await import('../route')

    const response = await GET(
      createRequest(
        'http://localhost:3000/console/auth/refresh?redirect_url=%2Fconsole%2Fauth%2Frefresh',
        'refresh_token=expired',
      ),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/console/signin?redirect_url=%2Fconsole%2F')
  })

  it('should fall back when an unprefixed refresh target resolves to the base path route', async () => {
    mocks.basePath = '/console'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    const { GET } = await import('../route')

    const response = await GET(
      createRequest(
        'http://localhost:3000/console/auth/refresh?redirect_url=%2Fauth%2Frefresh',
        'refresh_token=expired',
      ),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/console/signin?redirect_url=%2Fconsole%2F')
  })

  it('should fall back when repeated slashes resolve to the base path refresh route', async () => {
    mocks.basePath = '/console'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    const { GET } = await import('../route')
    const searchParams = new URLSearchParams({ redirect_url: '/auth//refresh' })

    const response = await GET(
      createRequest(
        `http://localhost:3000/console/auth/refresh?${searchParams}`,
        'refresh_token=expired',
      ),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/console/signin?redirect_url=%2Fconsole%2F')
  })
})
