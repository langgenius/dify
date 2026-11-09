/**
 * @vitest-environment node
 */
import type { CookieRewriteOptions, DevProxyRoute } from './types'
import { describe, expect, it, vi } from 'vite-plus/test'
import { resolveCookieRewriteLocalScopeKey, toScopedLocalCookieName } from './cookies'
import { createDevProxyApp } from './server'
import { extractSessionCookieValue } from './session-import'

const cookieRewrite: CookieRewriteOptions = {
  hostPrefixCookies: ['access_token', 'refresh_token'],
  localCookieScope: 'target-origin',
}

const createApp = (fetchImpl: typeof fetch, requestHeaders?: DevProxyRoute['requestHeaders']) =>
  createDevProxyApp({
    routes: [
      { paths: '/console/api', target: 'https://cloud.example.com', cookieRewrite, requestHeaders },
    ],
    sessionImport: {
      refreshPath: '/console/api/refresh-token',
      cookieName: 'refresh_token',
      redirectTo: 'http://localhost:3000',
    },
    fetchImpl,
  })

const postInput = (input: string, headers: Record<string, string> = {}) =>
  new Request('http://localhost:5001/', {
    method: 'POST',
    headers,
    body: new URLSearchParams({ input }),
  })

describe('session import', () => {
  // Scenario: DevTools copies should yield the session cookie without manual trimming.
  it('should extract the cookie value from pasted requests', () => {
    // Assert
    expect(
      extractSessionCookieValue(
        "curl 'https://cloud.example.com/console/api/apps' -b 'theme=dark; __Host-refresh_token=abc123; __Host-access_token=xyz'",
        'refresh_token',
      ),
    ).toBe('abc123')
    expect(extractSessionCookieValue('cookie: refresh_token=abc123', 'refresh_token')).toBe(
      'abc123',
    )
    expect(extractSessionCookieValue('  abc123\n', 'refresh_token')).toBe('abc123')
    expect(
      extractSessionCookieValue('Cookie: webapp_refresh_token=nope; theme=dark', 'refresh_token'),
    ).toBeUndefined()
  })

  // Scenario: importing should rotate the pasted token upstream and store the new session locally.
  it('should refresh upstream and set scoped local cookies', async () => {
    // Arrange
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"result":"success"}', {
        status: 200,
        headers: [
          ['set-cookie', '__Host-access_token=new-access; Path=/; Secure; HttpOnly; SameSite=Lax'],
          [
            'set-cookie',
            '__Host-refresh_token=new-refresh; Path=/; Secure; HttpOnly; SameSite=Lax',
          ],
        ],
      }),
    )
    const scopeKey = resolveCookieRewriteLocalScopeKey(
      cookieRewrite,
      new URL('https://cloud.example.com'),
    )!

    // Act
    const response = await createApp(fetchImpl).request(
      postInput("curl 'x' -b '__Host-refresh_token=old-refresh'", {
        origin: 'http://localhost:5001',
        'user-agent': 'test-browser',
      }),
    )

    // Assert
    const [url, init] = fetchImpl.mock.calls[0]!
    const upstreamHeaders = new Headers(init?.headers)
    expect(String(url)).toBe('https://cloud.example.com/console/api/refresh-token')
    expect(init?.method).toBe('POST')
    expect(upstreamHeaders.get('cookie')).toBe('__Host-refresh_token=old-refresh')
    expect(upstreamHeaders.get('user-agent')).toBe('test-browser')
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost:3000')
    expect(response.headers.getSetCookie()).toEqual([
      `${toScopedLocalCookieName('access_token', scopeKey)}=new-access; Path=/; HttpOnly; SameSite=Lax`,
      `${toScopedLocalCookieName('refresh_token', scopeKey)}=new-refresh; Path=/; HttpOnly; SameSite=Lax`,
    ])
  })

  // Scenario: session imports must authenticate with configured gateway service headers.
  it('should include configured request headers when refreshing an imported session', async () => {
    // Arrange
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{}', {
        headers: { 'set-cookie': '__Host-access_token=new-access; Path=/; Secure; HttpOnly' },
      }),
    )

    // Act
    const response = await createApp(fetchImpl, {
      'CF-Access-Client-Id': 'configured-id',
      'CF-Access-Client-Secret': 'configured-secret',
    }).request(postInput('old-refresh'))

    // Assert
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers)
    expect(headers.get('cookie')).toBe('__Host-refresh_token=old-refresh')
    expect(headers.get('cf-access-client-id')).toBe('configured-id')
    expect(headers.get('cf-access-client-secret')).toBe('configured-secret')
    expect(response.status).toBe(303)
  })

  // Scenario: an expired or already-rotated token should be reported instead of redirecting.
  it('should show the upstream error when refresh fails', async () => {
    // Arrange
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('Invalid refresh token', { status: 401 }))

    // Act
    const response = await createApp(fetchImpl).request(postInput('stale-token'))

    // Assert
    expect(response.status).toBe(502)
    expect(response.headers.getSetCookie()).toEqual([])
    expect(await response.text()).toContain('Refresh failed with 401: Invalid refresh token')
  })

  // Scenario: a successful refresh without cookies must not look like a completed import.
  it('should show an error when refresh returns no cookies', async () => {
    // Arrange
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }))

    // Act
    const response = await createApp(fetchImpl).request(postInput('token'))

    // Assert
    expect(response.status).toBe(502)
    expect(response.headers.get('location')).toBeNull()
    expect(await response.text()).toContain('Refresh succeeded but returned no cookies.')
  })

  // Scenario: pasted text without the session cookie should be rejected before calling upstream.
  it('should reject pasted text without the session cookie', async () => {
    // Arrange
    const fetchImpl = vi.fn<typeof fetch>()

    // Act
    const response = await createApp(fetchImpl).request(postInput('cookie: theme=dark'))

    // Assert
    expect(response.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(await response.text()).toContain('No refresh_token cookie found in the pasted text.')
  })

  // Scenario: the import page should link to the upstream that the refresh route targets.
  it('should serve the import page at the proxy root', async () => {
    // Act
    const response = await createApp(vi.fn<typeof fetch>()).request('http://localhost:5001/')

    // Assert
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('href="https://cloud.example.com"')
  })

  // Scenario: a refresh path outside every route is a config error.
  it('should throw when no route matches the refresh path', () => {
    // Assert
    expect(() =>
      createDevProxyApp({
        routes: [{ paths: '/api', target: 'https://cloud.example.com' }],
        sessionImport: {
          refreshPath: '/console/api/refresh-token',
          cookieName: 'refresh_token',
          redirectTo: 'http://localhost:3000',
        },
      }),
    ).toThrow('No dev proxy route matches session import path "/console/api/refresh-token".')
  })

  // Scenario: other sites must not be able to plant a session through the local proxy.
  it('should reject cross-origin imports', async () => {
    // Arrange
    const fetchImpl = vi.fn<typeof fetch>()

    // Act
    const response = await createApp(fetchImpl).request(
      postInput('token', { origin: 'https://evil.example.com' }),
    )

    // Assert
    expect(response.status).toBe(403)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
