/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildUpstreamUrl, createDevProxyApp, isAllowedDevOrigin } from './server'

describe('dev proxy server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Scenario: target paths should not be duplicated when the incoming route already includes them.
  it('should preserve prefixed targets when building upstream URLs', () => {
    // Act
    const url = buildUpstreamUrl('https://api.example.com/console/api', '/console/api/apps', '?page=1')

    // Assert
    expect(url.href).toBe('https://api.example.com/console/api/apps?page=1')
  })

  // Scenario: only localhost dev origins should be reflected for credentialed CORS by default.
  it('should only allow local development origins by default', () => {
    // Assert
    expect(isAllowedDevOrigin('http://localhost:3000')).toBe(true)
    expect(isAllowedDevOrigin('http://127.0.0.1:3000')).toBe(true)
    expect(isAllowedDevOrigin('https://example.com')).toBe(false)
  })

  // Scenario: explicit CORS origins should support non-local development hosts.
  it('should allow explicitly configured origins', () => {
    // Assert
    expect(isAllowedDevOrigin('https://app.example.com', ['https://app.example.com'])).toBe(true)
    expect(isAllowedDevOrigin('https://other.example.com', ['https://app.example.com'])).toBe(false)
  })

  // Scenario: proxy requests should rewrite cookies and surface credentialed CORS headers when configured.
  it('should proxy api requests with configured local cookie rewriting', async () => {
    // Arrange
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok', {
      status: 200,
      headers: [
        ['content-encoding', 'br'],
        ['content-length', '123'],
        ['set-cookie', '__Host-access_token=abc; Path=/console/api; Domain=cloud.example.com; Secure; SameSite=None'],
        ['transfer-encoding', 'chunked'],
      ],
    }))
    const app = createDevProxyApp({
      routes: [
        {
          paths: '/console/api',
          target: 'https://cloud.example.com',
          cookieRewrite: {
            hostPrefixCookies: ['access_token'],
          },
        },
      ],
      fetchImpl,
    })

    // Act
    const response = await app.request('http://127.0.0.1:5001/console/api/apps?page=1', {
      headers: {
        'Origin': 'http://localhost:3000',
        'Cookie': 'access_token=abc; theme=dark',
        'Accept-Encoding': 'zstd, br, gzip',
      },
    })

    // Assert
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('https://cloud.example.com/console/api/apps?page=1'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.any(Headers),
      }),
    )

    const requestHeaders = fetchImpl.mock.calls[0]?.[1]?.headers
    if (!(requestHeaders instanceof Headers))
      throw new Error('Expected proxy request headers to be Headers')

    expect(requestHeaders.get('cookie')).toBe('__Host-access_token=abc; theme=dark')
    expect(requestHeaders.get('origin')).toBe('https://cloud.example.com')
    expect(requestHeaders.get('accept-encoding')).toBe('identity')
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
    expect(response.headers.get('content-encoding')).toBeNull()
    expect(response.headers.get('content-length')).toBeNull()
    expect(response.headers.get('transfer-encoding')).toBeNull()
    expect(response.headers.getSetCookie()).toEqual([
      'access_token=abc; Path=/; SameSite=Lax',
    ])
  })

  // Scenario: generic proxy routes should not know Dify cookie names by default.
  it('should not rewrite cookie names when cookie rewriting is not configured', async () => {
    // Arrange
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'))
    const app = createDevProxyApp({
      routes: [
        {
          paths: '/api',
          target: 'https://api.example.com',
        },
      ],
      fetchImpl,
    })

    // Act
    await app.request('http://127.0.0.1:5001/api/messages', {
      headers: {
        Cookie: 'access_token=abc; refresh_token=def',
      },
    })

    // Assert
    const requestHeaders = fetchImpl.mock.calls[0]?.[1]?.headers
    if (!(requestHeaders instanceof Headers))
      throw new Error('Expected proxy request headers to be Headers')

    expect(requestHeaders.get('cookie')).toBe('access_token=abc; refresh_token=def')
  })

  // Scenario: local HTTP upstreams expect local cookie names even when cookie rewriting is configured.
  it('should keep local cookie names for HTTP upstream targets', async () => {
    // Arrange
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'))
    const app = createDevProxyApp({
      routes: [
        {
          paths: '/console/api',
          target: 'http://127.0.0.1:5001',
          cookieRewrite: {
            hostPrefixCookies: ['access_token', 'refresh_token'],
          },
        },
      ],
      fetchImpl,
    })

    // Act
    await app.request('http://127.0.0.1:5010/console/api/account/profile', {
      headers: {
        Cookie: 'access_token=abc; refresh_token=def',
      },
    })

    // Assert
    const requestHeaders = fetchImpl.mock.calls[0]?.[1]?.headers
    if (!(requestHeaders instanceof Headers))
      throw new Error('Expected proxy request headers to be Headers')

    expect(requestHeaders.get('cookie')).toBe('access_token=abc; refresh_token=def')
  })

  // Scenario: custom route paths should support independent upstream targets.
  it('should proxy custom route paths to their configured targets', async () => {
    // Arrange
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'))
    const app = createDevProxyApp({
      routes: [
        {
          paths: '/api',
          target: 'https://api.example.com',
        },
        {
          paths: '/files',
          target: 'https://files.example.com/assets',
        },
      ],
      fetchImpl,
    })

    // Act
    await app.request('http://127.0.0.1:5001/api/messages')
    await app.request('http://127.0.0.1:5001/files/logo.png?size=small')

    // Assert
    expect(fetchImpl.mock.calls.map(([url]) => url.toString())).toEqual([
      'https://api.example.com/api/messages',
      'https://files.example.com/assets/files/logo.png?size=small',
    ])
  })

  // Scenario: routes are matched in config order so callers can put specific routes first.
  it('should prefer earlier route entries', async () => {
    // Arrange
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'))
    const app = createDevProxyApp({
      routes: [
        {
          paths: '/api/enterprise',
          target: 'https://enterprise.example.com',
        },
        {
          paths: '/api',
          target: 'https://api.example.com',
        },
      ],
      fetchImpl,
    })

    // Act
    await app.request('http://127.0.0.1:5001/api/enterprise/sso/login')

    // Assert
    expect(fetchImpl.mock.calls.map(([url]) => url.toString())).toEqual([
      'https://enterprise.example.com/api/enterprise/sso/login',
    ])
  })

  // Scenario: preflight requests should advertise allowed headers for credentialed cross-origin calls.
  it('should answer CORS preflight requests', async () => {
    // Arrange
    const app = createDevProxyApp({
      routes: [
        {
          paths: '/api',
          target: 'https://api.example.com',
        },
      ],
      fetchImpl: vi.fn<typeof fetch>(),
    })

    // Act
    const response = await app.request('http://127.0.0.1:5001/api/messages', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Headers': 'authorization,content-type,x-csrf-token',
      },
    })

    // Assert
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
    expect(response.headers.get('access-control-allow-headers')).toBe('authorization,content-type,x-csrf-token')
  })
})
