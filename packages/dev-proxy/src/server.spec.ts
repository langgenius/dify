/**
 * @vitest-environment node
 */
import { Buffer } from 'node:buffer'
import http from 'node:http'
import net from 'node:net'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveCookieRewriteLocalScopeKey, toScopedLocalCookieName } from './cookies'
import {
  buildUpstreamUrl,
  createDevProxyApp,
  createWebSocketUpgradeHandler,
  isAllowedDevOrigin,
} from './server'

const listen = (server: http.Server) =>
  new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to start test server.'))
        return
      }
      resolve(address.port)
    })
  })

const close = (server: http.Server) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })

describe('dev proxy server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Scenario: target paths should not be duplicated when the incoming route already includes them.
  it('should preserve prefixed targets when building upstream URLs', () => {
    // Act
    const url = buildUpstreamUrl(
      'https://api.example.com/console/api',
      '/console/api/apps',
      '?page=1',
    )

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
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('ok', {
        status: 200,
        headers: [
          ['content-encoding', 'br'],
          ['content-length', '123'],
          [
            'set-cookie',
            '__Host-access_token=abc; Path=/console/api; Domain=cloud.example.com; Secure; SameSite=None',
          ],
          ['transfer-encoding', 'chunked'],
        ],
      }),
    )
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
        Origin: 'http://localhost:3000',
        Cookie: 'access_token=abc; theme=dark',
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
    expect(response.headers.getSetCookie()).toEqual(['access_token=abc; Path=/; SameSite=Lax'])
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

  // Scenario: scoped Dify auth cookies should prevent stale local cookies from leaking across targets.
  it('should proxy target-scoped auth cookies and override stale CSRF headers', async () => {
    // Arrange
    const cookieRewrite = {
      hostPrefixCookies: ['access_token', 'csrf_token', 'refresh_token'],
      localCookieScope: 'target-origin' as const,
      csrfHeader: {
        cookieName: 'csrf_token',
        headerName: 'X-CSRF-Token',
      },
    }
    const targetUrl = new URL('https://cloud.example.com')
    const localScopeKey = resolveCookieRewriteLocalScopeKey(cookieRewrite, targetUrl)!
    const accessTokenCookieName = toScopedLocalCookieName('access_token', localScopeKey)
    const csrfTokenCookieName = toScopedLocalCookieName('csrf_token', localScopeKey)
    const otherScopeAccessTokenCookieName = toScopedLocalCookieName('access_token', 'other')
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('ok', {
        status: 200,
        headers: [
          [
            'set-cookie',
            '__Host-access_token=next; Path=/console/api; Domain=cloud.example.com; Secure; SameSite=None',
          ],
        ],
      }),
    )
    const app = createDevProxyApp({
      routes: [
        {
          paths: '/console/api',
          target: targetUrl.origin,
          cookieRewrite,
        },
      ],
      fetchImpl,
    })

    // Act
    const response = await app.request('http://127.0.0.1:5001/console/api/apps', {
      headers: {
        Cookie: [
          `${accessTokenCookieName}=current-access`,
          `${csrfTokenCookieName}=current-csrf`,
          'access_token=legacy-access',
          'csrf_token=legacy-csrf',
          `${otherScopeAccessTokenCookieName}=other-access`,
          'theme=dark',
        ].join('; '),
        'X-CSRF-Token': 'legacy-csrf',
      },
    })

    // Assert
    const requestHeaders = fetchImpl.mock.calls[0]?.[1]?.headers
    if (!(requestHeaders instanceof Headers))
      throw new Error('Expected proxy request headers to be Headers')

    expect(requestHeaders.get('cookie')).toBe(
      '__Host-access_token=current-access; __Host-csrf_token=current-csrf; theme=dark',
    )
    expect(requestHeaders.get('x-csrf-token')).toBe('current-csrf')
    expect(response.headers.getSetCookie()).toEqual([
      `${accessTokenCookieName}=next; Path=/; SameSite=Lax`,
    ])
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

  // Scenario: Socket.IO collaboration must reuse the auth cookies stored by the local dev proxy.
  it('should proxy WebSocket upgrades with the configured cookie rewriting', async () => {
    // Arrange
    const sockets = new Set<net.Socket>()
    let upstreamRequest:
      | {
          connection: string | undefined
          cookie: string | undefined
          keepAlive: string | string[] | undefined
          origin: string | undefined
          proxyAuthorization: string | undefined
          te: string | string[] | undefined
          upgrade: string | undefined
          url: string | undefined
          xHop: string | string[] | undefined
        }
      | undefined
    const upstreamServer = http.createServer()
    upstreamServer.on('connection', (socket) => sockets.add(socket))
    upstreamServer.on('upgrade', (request, socket) => {
      upstreamRequest = {
        connection: request.headers.connection,
        cookie: request.headers.cookie,
        keepAlive: request.headers['keep-alive'],
        origin: request.headers.origin,
        proxyAuthorization: request.headers['proxy-authorization'],
        te: request.headers.te,
        upgrade: request.headers.upgrade,
        url: request.url,
        xHop: request.headers['x-hop'],
      }
      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Connection: Upgrade, X-Upstream-Hop',
          'Upgrade: websocket',
          'X-Upstream-Hop: upstream-only',
          'Keep-Alive: timeout=5',
          'Proxy-Authenticate: Basic realm="proxy"',
          'Set-Cookie: __Host-access_token=next; Path=/socket.io; Domain=cloud.example.com; Secure; SameSite=None',
          'Set-Cookie: __Secure-refresh_token=renewed; Path=/socket.io; Domain=cloud.example.com; Secure; HttpOnly',
          '',
          'proxied websocket',
        ].join('\r\n'),
      )
    })
    const upstreamPort = await listen(upstreamServer)
    const upstreamOrigin = `http://127.0.0.1:${upstreamPort}`
    const cookieRewrite = {
      hostPrefixCookies: ['access_token', 'refresh_token'],
      localCookieScope: 'target-origin' as const,
    }
    const localScopeKey = resolveCookieRewriteLocalScopeKey(cookieRewrite, new URL(upstreamOrigin))!
    const accessTokenCookieName = toScopedLocalCookieName('access_token', localScopeKey)
    const refreshTokenCookieName = toScopedLocalCookieName('refresh_token', localScopeKey)

    const proxyServer = http.createServer()
    proxyServer.on(
      'upgrade',
      createWebSocketUpgradeHandler({
        routes: [{ paths: '/socket.io', target: upstreamOrigin, cookieRewrite }],
      }),
    )
    const proxyPort = await listen(proxyServer)
    const client = net.connect(proxyPort, '127.0.0.1')
    sockets.add(client)

    try {
      // Act
      const response = await new Promise<string>((resolve, reject) => {
        let value = ''
        const timeout = setTimeout(
          () => reject(new Error('Timed out waiting for WebSocket upgrade response.')),
          3000,
        )

        client.setEncoding('utf8')
        client.on('connect', () => {
          client.write(
            [
              'GET /socket.io/?EIO=4&transport=websocket HTTP/1.1',
              `Host: 127.0.0.1:${proxyPort}`,
              'Connection: Upgrade, X-Hop',
              'Upgrade: websocket',
              'X-Hop: client-only',
              'Keep-Alive: timeout=5',
              'Proxy-Authorization: Basic secret',
              'TE: trailers',
              'Origin: http://localhost:3000',
              `Cookie: ${accessTokenCookieName}=secret`,
              '',
              '',
            ].join('\r\n'),
          )
        })
        client.on('data', (chunk) => {
          value += chunk
          if (!value.includes('proxied websocket')) return

          clearTimeout(timeout)
          resolve(value)
        })
        client.on('error', (error) => {
          clearTimeout(timeout)
          reject(error)
        })
      })

      // Assert
      expect(response).toContain('101 Switching Protocols')
      expect(response).toContain('proxied websocket')
      expect(response).toContain('Connection: Upgrade\r\n')
      expect(response).toContain('Upgrade: websocket\r\n')
      expect(response).not.toMatch(/X-Upstream-Hop:/i)
      expect(response).not.toMatch(/Keep-Alive:/i)
      expect(response).not.toMatch(/Proxy-Authenticate:/i)
      expect(response).toContain(`Set-Cookie: ${accessTokenCookieName}=next; Path=/; SameSite=Lax`)
      expect(response).toContain(`Set-Cookie: ${refreshTokenCookieName}=renewed; Path=/; HttpOnly`)
      expect(response).not.toContain('__Host-access_token')
      expect(response).not.toContain('__Secure-refresh_token')
      expect(upstreamRequest).toEqual({
        connection: 'Upgrade',
        cookie: 'access_token=secret',
        keepAlive: undefined,
        origin: upstreamOrigin,
        proxyAuthorization: undefined,
        te: undefined,
        upgrade: 'websocket',
        url: '/socket.io/?EIO=4&transport=websocket',
        xHop: undefined,
      })
    } finally {
      sockets.forEach((socket) => socket.destroy())
      await Promise.all([close(proxyServer), close(upstreamServer)])
    }
  })

  // Scenario: invalid route targets should fail the individual Upgrade request, not the proxy process.
  it('should return a bad gateway response when a WebSocket target is invalid', async () => {
    // Arrange
    const logger = { error: vi.fn() }
    const clientSocket = new PassThrough()
    const request = {
      headers: {},
      method: 'GET',
      url: '/socket.io/?EIO=4&transport=websocket',
    } as http.IncomingMessage
    let response = ''
    clientSocket.setEncoding('utf8')
    clientSocket.on('data', (chunk) => {
      response += chunk
    })
    const handleUpgrade = createWebSocketUpgradeHandler({
      routes: [{ paths: '/socket.io', target: 'not a URL' }],
      logger,
    })

    // Act
    expect(() => handleUpgrade(request, clientSocket, Buffer.alloc(0))).not.toThrow()
    await new Promise<void>((resolve) => clientSocket.once('finish', resolve))

    // Assert
    expect(response).toContain('502 Bad Gateway')
    expect(logger.error).toHaveBeenCalledOnce()
  })

  // Scenario: parsed chunked bodies need close-delimited framing when an Upgrade is rejected upstream.
  it('should safely forward chunked non-upgrade responses', async () => {
    // Arrange
    const sockets = new Set<net.Socket>()
    const upstreamServer = http.createServer()
    upstreamServer.on('connection', (socket) => sockets.add(socket))
    upstreamServer.on('upgrade', (_request, socket) => {
      socket.end(
        [
          'HTTP/1.1 401 Unauthorized',
          'Connection: keep-alive',
          'Transfer-Encoding: chunked',
          'Content-Type: text/plain',
          '',
          '6',
          'denied',
          '0',
          '',
          '',
        ].join('\r\n'),
      )
    })
    const upstreamPort = await listen(upstreamServer)
    const proxyServer = http.createServer()
    proxyServer.on(
      'upgrade',
      createWebSocketUpgradeHandler({
        routes: [{ paths: '/socket.io', target: `http://127.0.0.1:${upstreamPort}` }],
      }),
    )
    const proxyPort = await listen(proxyServer)
    const client = net.connect(proxyPort, '127.0.0.1')
    sockets.add(client)

    try {
      // Act
      const response = await new Promise<string>((resolve, reject) => {
        let value = ''
        const timeout = setTimeout(
          () => reject(new Error('Timed out waiting for rejected Upgrade response.')),
          3000,
        )

        client.setEncoding('utf8')
        client.on('connect', () => {
          client.write(
            [
              'GET /socket.io/?EIO=4&transport=websocket HTTP/1.1',
              `Host: 127.0.0.1:${proxyPort}`,
              'Connection: Upgrade',
              'Upgrade: websocket',
              '',
              '',
            ].join('\r\n'),
          )
        })
        client.on('data', (chunk) => {
          value += chunk
        })
        client.on('end', () => {
          clearTimeout(timeout)
          resolve(value)
        })
        client.on('error', (error) => {
          clearTimeout(timeout)
          reject(error)
        })
      })

      // Assert
      expect(response).toContain('401 Unauthorized')
      expect(response).toContain('Connection: close')
      expect(response).not.toMatch(/Transfer-Encoding:/i)
      expect(response.endsWith('\r\n\r\ndenied')).toBe(true)
    } finally {
      sockets.forEach((socket) => socket.destroy())
      await Promise.all([close(proxyServer), close(upstreamServer)])
    }
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
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Headers': 'authorization,content-type,x-csrf-token',
      },
    })

    // Assert
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
    expect(response.headers.get('access-control-allow-headers')).toBe(
      'authorization,content-type,x-csrf-token',
    )
  })
})
