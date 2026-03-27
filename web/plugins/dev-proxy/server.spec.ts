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
    })

    // Assert
    expect(targets.consoleApiTarget).toBe('https://console.example.com')
    expect(targets.publicApiTarget).toBe('https://public.example.com')
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
      fetchImpl,
    })

    // Act
    const response = await app.request('http://127.0.0.1:5001/console/api/apps?page=1', {
      headers: {
        Origin: 'http://localhost:3000',
        Cookie: 'access_token=abc',
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

    const [, requestInit] = fetchImpl.mock.calls[0]
    const requestHeaders = requestInit?.headers as Headers
    expect(requestHeaders.get('cookie')).toBe('__Host-access_token=abc')
    expect(requestHeaders.get('origin')).toBe('https://cloud.dify.ai')
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
    expect(response.headers.get('content-encoding')).toBeNull()
    expect(response.headers.get('content-length')).toBeNull()
    expect(response.headers.get('transfer-encoding')).toBeNull()
    expect(response.headers.getSetCookie()).toEqual([
      'access_token=abc; Path=/; SameSite=Lax',
    ])
  })

  // Scenario: preflight requests should advertise allowed headers for credentialed cross-origin calls.
  it('should answer CORS preflight requests', async () => {
    // Arrange
    const app = createDevProxyApp({
      consoleApiTarget: 'https://cloud.dify.ai',
      publicApiTarget: 'https://public.dify.ai',
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
