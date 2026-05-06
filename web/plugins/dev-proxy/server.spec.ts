/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildUpstreamUrl, createDevProxyApp, isAllowedDevOrigin, resolveDevProxyTargets } from './server'

describe('dev proxy server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Scenario: Hono proxy targets should be read directly from env.
  it('should resolve Hono proxy targets from env', () => {
    // Arrange
    const targets = resolveDevProxyTargets({
      HONO_CONSOLE_API_PROXY_TARGET: 'https://console.example.com',
      HONO_PUBLIC_API_PROXY_TARGET: 'https://public.example.com',
      HONO_ENTERPRISE_API_PROXY_TARGET: 'https://enterprise.example.com',
    })

    // Assert
    expect(targets.consoleApiTarget).toBe('https://console.example.com')
    expect(targets.publicApiTarget).toBe('https://public.example.com')
    expect(targets.enterpriseApiTarget).toBe('https://enterprise.example.com')
  })

  // Scenario: optional proxy targets should use their route-specific defaults.
  it('should use console target as the default for optional targets', () => {
    // Act
    const targets = resolveDevProxyTargets({
      HONO_CONSOLE_API_PROXY_TARGET: 'https://console.example.com',
    })

    // Assert
    expect(targets.consoleApiTarget).toBe('https://console.example.com')
    expect(targets.publicApiTarget).toBe('https://console.example.com')
    expect(targets.enterpriseApiTarget).toBeUndefined()
  })

  // Scenario: target paths should not be duplicated when the incoming route already includes them.
  it('should preserve prefixed targets when building upstream URLs', () => {
    // Act
    const url = buildUpstreamUrl('https://api.example.com/console/api', '/console/api/apps', '?page=1')

    // Assert
    expect(url.href).toBe('https://api.example.com/console/api/apps?page=1')
  })

  // Scenario: only localhost dev origins should be reflected for credentialed CORS.
  it('should only allow local development origins', () => {
    // Assert
    expect(isAllowedDevOrigin('http://localhost:3000')).toBe(true)
    expect(isAllowedDevOrigin('http://127.0.0.1:3000')).toBe(true)
    expect(isAllowedDevOrigin('https://example.com')).toBe(false)
  })

  // Scenario: proxy requests should rewrite cookies and surface credentialed CORS headers.
  it('should proxy api requests through Hono with local cookie rewriting', async () => {
    // Arrange
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok', {
      status: 200,
      headers: [
        ['content-encoding', 'br'],
        ['content-length', '123'],
        ['set-cookie', '__Host-access_token=abc; Path=/console/api; Domain=cloud.dify.ai; Secure; SameSite=None'],
        ['transfer-encoding', 'chunked'],
      ],
    }))
    const app = createDevProxyApp({
      consoleApiTarget: 'https://cloud.dify.ai',
      publicApiTarget: 'https://public.dify.ai',
      enterpriseApiTarget: 'https://enterprise.dify.ai',
      fetchImpl,
    })

    // Act
    const response = await app.request('http://127.0.0.1:5001/console/api/apps?page=1', {
      headers: {
        'Origin': 'http://localhost:3000',
        'Cookie': 'access_token=abc',
        'Accept-Encoding': 'zstd, br, gzip',
      },
    })

    // Assert
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('https://cloud.dify.ai/console/api/apps?page=1'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.any(Headers),
      }),
    )

    const requestHeaders = fetchImpl.mock.calls[0]?.[1]?.headers
    if (!(requestHeaders instanceof Headers))
      throw new Error('Expected proxy request headers to be Headers')

    expect(requestHeaders.get('cookie')).toBe('__Host-access_token=abc')
    expect(requestHeaders.get('origin')).toBe('https://cloud.dify.ai')
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

  // Scenario: a local HTTP Dify API expects the non-prefixed local cookie name.
  it('should keep local cookie names for HTTP upstream targets', async () => {
    // Arrange
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'))
    const app = createDevProxyApp({
      consoleApiTarget: 'http://127.0.0.1:5001',
      publicApiTarget: 'http://127.0.0.1:5001',
      enterpriseApiTarget: 'http://127.0.0.1:8082',
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

  // Scenario: Enterprise dashboard routes should use the Enterprise target before generic API routes.
  it('should proxy enterprise api routes to the enterprise target', async () => {
    // Arrange
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'))
    const app = createDevProxyApp({
      consoleApiTarget: 'https://console.example.com',
      publicApiTarget: 'https://public.example.com',
      enterpriseApiTarget: 'https://enterprise.example.com',
      fetchImpl,
    })

    const requestUrls = [
      'http://127.0.0.1:5001/console/api/enterprise/sso/saml/login',
      'http://127.0.0.1:5001/api/enterprise/sso/oauth2/login',
      'http://127.0.0.1:5001/admin-api/v1/workspaces',
      'http://127.0.0.1:5001/inner/api/info',
      'http://127.0.0.1:5001/mfa/v1/verify',
      'http://127.0.0.1:5001/scim/v2/Users',
      'http://127.0.0.1:5001/v1/audit/logs',
      'http://127.0.0.1:5001/v1/dashboard/api/license/status',
      'http://127.0.0.1:5001/v1/healthz',
      'http://127.0.0.1:5001/v1/plugin-manager/plugins',
    ]

    // Act
    for (const url of requestUrls)
      await app.request(url)

    // Assert
    expect(fetchImpl).toHaveBeenCalledTimes(requestUrls.length)
    expect(fetchImpl.mock.calls.map(([url]) => url.toString())).toEqual([
      'https://enterprise.example.com/console/api/enterprise/sso/saml/login',
      'https://enterprise.example.com/api/enterprise/sso/oauth2/login',
      'https://enterprise.example.com/admin-api/v1/workspaces',
      'https://enterprise.example.com/inner/api/info',
      'https://enterprise.example.com/mfa/v1/verify',
      'https://enterprise.example.com/scim/v2/Users',
      'https://enterprise.example.com/v1/audit/logs',
      'https://enterprise.example.com/v1/dashboard/api/license/status',
      'https://enterprise.example.com/v1/healthz',
      'https://enterprise.example.com/v1/plugin-manager/plugins',
    ])
  })

  // Scenario: preflight requests should advertise allowed headers for credentialed cross-origin calls.
  it('should answer CORS preflight requests', async () => {
    // Arrange
    const app = createDevProxyApp({
      consoleApiTarget: 'https://cloud.dify.ai',
      publicApiTarget: 'https://public.dify.ai',
      enterpriseApiTarget: 'https://enterprise.dify.ai',
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
