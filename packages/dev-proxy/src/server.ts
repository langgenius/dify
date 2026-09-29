import type { Context, Hono } from 'hono'
import type { Buffer } from 'node:buffer'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type {
  CookieRewriteOptions,
  CreateDevProxyAppOptions,
  DevProxyCorsAllowedOrigins,
  DevProxyRoute,
} from './types'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Hono as HonoApp } from 'hono'
import {
  getCookieHeaderValue,
  resolveCookieRewriteLocalScopeKey,
  rewriteCookieHeaderForUpstream,
  rewriteSetCookieHeadersForLocal,
  toScopedLocalCookieName,
} from './cookies'

const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
const ALLOW_METHODS = 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS'
const DEFAULT_ALLOW_HEADERS = 'Authorization, Content-Type, X-CSRF-Token'
const UPSTREAM_ACCEPT_ENCODING = 'identity'
const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
] as const
const DECODED_RESPONSE_HEADERS_TO_DROP = ['content-encoding', 'content-length'] as const

const createHopByHopHeaderNames = (connectionHeader?: string | null) =>
  new Set([
    ...HOP_BY_HOP_HEADERS,
    ...(connectionHeader
      ?.split(',')
      .map((header) => header.trim().toLowerCase())
      .filter(Boolean) || []),
  ])

const removeHopByHopHeaders = (headers: Headers) => {
  createHopByHopHeaderNames(headers.get('connection')).forEach((header) => headers.delete(header))
}

const appendHeaderValue = (headers: Headers, name: string, value: string) => {
  const currentValue = headers.get(name)
  if (!currentValue) {
    headers.set(name, value)
    return
  }

  if (
    currentValue
      .split(',')
      .map((item) => item.trim())
      .includes(value)
  )
    return

  headers.set(name, `${currentValue}, ${value}`)
}

export const isAllowedLocalDevOrigin = (origin?: string | null) => {
  if (!origin) return false

  try {
    const url = new URL(origin)
    return LOCAL_DEV_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

export const isAllowedDevOrigin = (
  origin?: string | null,
  allowedOrigins: DevProxyCorsAllowedOrigins = 'local',
) => {
  if (!origin) return false

  if (allowedOrigins === 'local') return isAllowedLocalDevOrigin(origin)

  return allowedOrigins.includes(origin)
}

const applyCorsHeaders = (
  headers: Headers,
  origin: string | undefined | null,
  allowedOrigins: DevProxyCorsAllowedOrigins = 'local',
) => {
  if (!isAllowedDevOrigin(origin, allowedOrigins)) return

  headers.set('Access-Control-Allow-Origin', origin!)
  headers.set('Access-Control-Allow-Credentials', 'true')
  appendHeaderValue(headers, 'Vary', 'Origin')
}

export const buildUpstreamUrl = (target: string, requestPath: string, search = '') => {
  const targetUrl = new URL(target)
  const normalizedTargetPath =
    targetUrl.pathname === '/' ? '' : targetUrl.pathname.replace(/\/$/, '')
  const normalizedRequestPath = requestPath.startsWith('/') ? requestPath : `/${requestPath}`
  const hasTargetPrefix =
    normalizedTargetPath &&
    (normalizedRequestPath === normalizedTargetPath ||
      normalizedRequestPath.startsWith(`${normalizedTargetPath}/`))

  targetUrl.pathname = hasTargetPrefix
    ? normalizedRequestPath
    : `${normalizedTargetPath}${normalizedRequestPath}`
  targetUrl.search = search

  return targetUrl
}

const createProxyRequestHeaders = (
  headers: Headers,
  targetUrl: URL,
  cookieRewrite: CookieRewriteOptions | false | undefined,
) => {
  const upstreamHeaders = new Headers(headers)
  removeHopByHopHeaders(upstreamHeaders)
  upstreamHeaders.delete('host')
  upstreamHeaders.set('accept-encoding', UPSTREAM_ACCEPT_ENCODING)

  if (upstreamHeaders.has('origin')) upstreamHeaders.set('origin', targetUrl.origin)

  if (cookieRewrite) {
    const originalCookieHeader = upstreamHeaders.get('cookie') || undefined
    const localScopeKey = resolveCookieRewriteLocalScopeKey(cookieRewrite, targetUrl)
    const rewrittenCookieHeader = rewriteCookieHeaderForUpstream(
      upstreamHeaders.get('cookie') || undefined,
      {
        ...cookieRewrite,
        localScopeKey,
        useHostPrefix: targetUrl.protocol === 'https:',
      },
    )
    if (rewrittenCookieHeader) upstreamHeaders.set('cookie', rewrittenCookieHeader)
    else upstreamHeaders.delete('cookie')

    if (localScopeKey && cookieRewrite.csrfHeader) {
      const scopedCsrfCookieName = toScopedLocalCookieName(
        cookieRewrite.csrfHeader.cookieName,
        localScopeKey,
      )
      const scopedCsrfToken = getCookieHeaderValue(originalCookieHeader, scopedCsrfCookieName)
      if (scopedCsrfToken) upstreamHeaders.set(cookieRewrite.csrfHeader.headerName, scopedCsrfToken)
      else upstreamHeaders.delete(cookieRewrite.csrfHeader.headerName)
    }
  }

  return upstreamHeaders
}

const getSetCookieHeaders = (headers: Headers) => {
  const headersWithGetSetCookie = headers as Headers & { getSetCookie?: () => string[] }
  const setCookieHeaders = headersWithGetSetCookie.getSetCookie?.()
  if (setCookieHeaders?.length) return setCookieHeaders

  const setCookie = headers.get('set-cookie')
  return setCookie ? [setCookie] : []
}

const createUpstreamResponseHeaders = (
  response: Response,
  targetUrl: URL,
  requestOrigin: string | undefined | null,
  allowedOrigins: DevProxyCorsAllowedOrigins,
  cookieRewrite: CookieRewriteOptions | false | undefined,
) => {
  const headers = new Headers(response.headers)
  removeHopByHopHeaders(headers)
  DECODED_RESPONSE_HEADERS_TO_DROP.forEach((header) => headers.delete(header))
  headers.delete('set-cookie')

  const localScopeKey = cookieRewrite
    ? resolveCookieRewriteLocalScopeKey(cookieRewrite, targetUrl)
    : undefined
  const setCookieHeaders = getSetCookieHeaders(response.headers)
  const responseSetCookieHeaders = cookieRewrite
    ? rewriteSetCookieHeadersForLocal(setCookieHeaders, {
        ...cookieRewrite,
        localScopeKey,
      })
    : setCookieHeaders

  responseSetCookieHeaders.forEach((cookie) => {
    headers.append('set-cookie', cookie)
  })

  applyCorsHeaders(headers, requestOrigin, allowedOrigins)
  return headers
}

const proxyRequest = async (
  context: Context,
  route: DevProxyRoute,
  fetchImpl: typeof globalThis.fetch,
  allowedOrigins: DevProxyCorsAllowedOrigins,
) => {
  const requestUrl = new URL(context.req.url)
  const targetUrl = buildUpstreamUrl(route.target, requestUrl.pathname, requestUrl.search)
  const requestHeaders = createProxyRequestHeaders(
    context.req.raw.headers,
    targetUrl,
    route.cookieRewrite,
  )
  const requestInit: RequestInit & { duplex?: 'half' } = {
    method: context.req.method,
    headers: requestHeaders,
    redirect: 'manual',
  }

  if (context.req.method !== 'GET' && context.req.method !== 'HEAD') {
    requestInit.body = context.req.raw.body
    requestInit.duplex = 'half'
  }

  const upstreamResponse = await fetchImpl(targetUrl, requestInit)
  const responseHeaders = createUpstreamResponseHeaders(
    upstreamResponse,
    targetUrl,
    context.req.header('origin'),
    allowedOrigins,
    route.cookieRewrite,
  )

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  })
}

const normalizeRoutePaths = (paths: DevProxyRoute['paths']) =>
  Array.isArray(paths) ? paths : [paths]

const findProxyRoute = (routes: readonly DevProxyRoute[], requestPath: string) =>
  routes.find((route) =>
    normalizeRoutePaths(route.paths).some(
      (routePath) => requestPath === routePath || requestPath.startsWith(`${routePath}/`),
    ),
  )

const createHeadersFromIncomingMessage = (request: IncomingMessage) => {
  const headers = new Headers()
  Object.entries(request.headers).forEach(([name, value]) => {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item))
    else if (value !== undefined) headers.set(name, value)
  })
  return headers
}

type ResponseHeader = readonly [name: string, value: string]

const createIncomingResponseHeaders = (
  response: IncomingMessage,
  targetUrl: URL,
  cookieRewrite: CookieRewriteOptions | false | undefined,
  connectionMode: 'close' | 'upgrade',
) => {
  const headers: ResponseHeader[] = []
  const setCookieHeaders: string[] = []
  const headersToDrop = createHopByHopHeaderNames(response.headers.connection)

  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    const name = response.rawHeaders[index]
    const value = response.rawHeaders[index + 1]
    if (!name || value === undefined) continue

    const normalizedName = name.toLowerCase()
    if (normalizedName === 'set-cookie') setCookieHeaders.push(value)
    else if (!headersToDrop.has(normalizedName)) headers.push([name, value])
  }

  const localScopeKey = cookieRewrite
    ? resolveCookieRewriteLocalScopeKey(cookieRewrite, targetUrl)
    : undefined
  const responseSetCookieHeaders = cookieRewrite
    ? rewriteSetCookieHeadersForLocal(setCookieHeaders, {
        ...cookieRewrite,
        localScopeKey,
      })
    : setCookieHeaders
  responseSetCookieHeaders.forEach((cookie) => headers.push(['Set-Cookie', cookie]))

  if (connectionMode === 'upgrade') {
    headers.push(['Connection', 'Upgrade'])
    headers.push(['Upgrade', response.headers.upgrade || 'websocket'])
  } else {
    headers.push(['Connection', 'close'])
  }
  return headers
}

const writeIncomingResponseHead = (
  socket: Duplex,
  response: IncomingMessage,
  headers: readonly ResponseHeader[],
) => {
  const statusCode = response.statusCode || 502
  const statusMessage = response.statusMessage || 'Bad Gateway'
  socket.write(`HTTP/1.1 ${statusCode} ${statusMessage}\r\n`)
  headers.forEach(([name, value]) => socket.write(`${name}: ${value}\r\n`))
  socket.write('\r\n')
}

const closeUpgradeRequest = (socket: Duplex, statusCode: number, statusMessage: string) => {
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusMessage}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  )
}

export const createWebSocketUpgradeHandler = (
  options: Pick<CreateDevProxyAppOptions, 'routes' | 'cors' | 'logger'>,
) => {
  const logger = options.logger || console
  const allowedOrigins = options.cors?.allowedOrigins || 'local'

  const handleUpgrade = (request: IncomingMessage, clientSocket: Duplex, head: Buffer) => {
    const requestOrigin = request.headers.origin
    if (requestOrigin && !isAllowedDevOrigin(requestOrigin, allowedOrigins)) {
      closeUpgradeRequest(clientSocket, 403, 'Forbidden')
      return
    }

    const requestUrl = new URL(request.url || '/', 'http://localhost')
    const route = findProxyRoute(options.routes, requestUrl.pathname)
    if (!route) {
      closeUpgradeRequest(clientSocket, 404, 'Not Found')
      return
    }

    const targetUrl = buildUpstreamUrl(route.target, requestUrl.pathname, requestUrl.search)
    const upgradeProtocol = request.headers.upgrade || 'websocket'
    const requestHeaders = createProxyRequestHeaders(
      createHeadersFromIncomingMessage(request),
      targetUrl,
      route.cookieRewrite,
    )
    requestHeaders.set('connection', 'Upgrade')
    requestHeaders.set('upgrade', upgradeProtocol)
    const requestImpl =
      targetUrl.protocol === 'https:'
        ? httpsRequest
        : targetUrl.protocol === 'http:'
          ? httpRequest
          : undefined
    if (!requestImpl) {
      logger.error(
        '[dev-proxy]',
        new Error(`Unsupported proxy target protocol: ${targetUrl.protocol}`),
      )
      closeUpgradeRequest(clientSocket, 502, 'Bad Gateway')
      return
    }

    const upstreamRequest = requestImpl(targetUrl, {
      headers: Object.fromEntries(requestHeaders.entries()),
      method: request.method,
    })
    let upstreamSocket: Duplex | undefined

    const closeUpstream = () => {
      if (upstreamSocket) upstreamSocket.destroy()
      else upstreamRequest.destroy()
    }
    clientSocket.once('close', closeUpstream)
    clientSocket.once('error', closeUpstream)

    upstreamRequest.on('upgrade', (response, socket, upstreamHead) => {
      upstreamSocket = socket
      if (clientSocket.destroyed) {
        socket.destroy()
        return
      }

      const responseHeaders = createIncomingResponseHeaders(
        response,
        targetUrl,
        route.cookieRewrite,
        'upgrade',
      )
      writeIncomingResponseHead(clientSocket, response, responseHeaders)
      if (upstreamHead.length) clientSocket.write(upstreamHead)
      if (head.length) socket.write(head)

      socket.once('error', () => clientSocket.destroy())
      socket.once('close', () => clientSocket.destroy())
      clientSocket.pipe(socket)
      socket.pipe(clientSocket)
    })

    upstreamRequest.on('response', (response) => {
      const responseHeaders = createIncomingResponseHeaders(
        response,
        targetUrl,
        route.cookieRewrite,
        'close',
      )
      writeIncomingResponseHead(clientSocket, response, responseHeaders)
      response.once('error', () => clientSocket.destroy())
      response.pipe(clientSocket)
    })

    upstreamRequest.on('error', (error) => {
      logger.error('[dev-proxy]', error)
      if (!clientSocket.destroyed) closeUpgradeRequest(clientSocket, 502, 'Bad Gateway')
    })

    upstreamRequest.end()
  }

  return (request: IncomingMessage, clientSocket: Duplex, head: Buffer) => {
    try {
      handleUpgrade(request, clientSocket, head)
    } catch (error) {
      logger.error('[dev-proxy]', error)
      if (!clientSocket.destroyed) closeUpgradeRequest(clientSocket, 502, 'Bad Gateway')
    }
  }
}

const registerProxyRoute = (
  app: Hono,
  route: DevProxyRoute,
  path: string,
  fetchImpl: typeof globalThis.fetch,
  allowedOrigins: DevProxyCorsAllowedOrigins,
) => {
  if (!path.startsWith('/'))
    throw new Error(`Invalid dev proxy route path "${path}". Paths must start with "/".`)

  app.all(path, (context) => proxyRequest(context, route, fetchImpl, allowedOrigins))
  app.all(`${path}/*`, (context) => proxyRequest(context, route, fetchImpl, allowedOrigins))
}

const registerProxyRoutes = (
  app: Hono,
  routes: readonly DevProxyRoute[],
  fetchImpl: typeof globalThis.fetch,
  allowedOrigins: DevProxyCorsAllowedOrigins,
) => {
  routes.forEach((route) => {
    normalizeRoutePaths(route.paths).forEach((path) => {
      registerProxyRoute(app, route, path, fetchImpl, allowedOrigins)
    })
  })
}

export const createDevProxyApp = (options: CreateDevProxyAppOptions) => {
  const app = new HonoApp()
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const logger = options.logger || console
  const allowedOrigins = options.cors?.allowedOrigins || 'local'

  app.onError((error, context) => {
    logger.error('[dev-proxy]', error)

    const headers = new Headers()
    applyCorsHeaders(headers, context.req.header('origin'), allowedOrigins)

    return new Response('Upstream proxy request failed.', {
      status: 502,
      headers,
    })
  })

  app.use('*', async (context, next) => {
    if (context.req.method === 'OPTIONS') {
      const headers = new Headers()
      applyCorsHeaders(headers, context.req.header('origin'), allowedOrigins)
      headers.set('Access-Control-Allow-Methods', ALLOW_METHODS)
      headers.set(
        'Access-Control-Allow-Headers',
        context.req.header('Access-Control-Request-Headers') || DEFAULT_ALLOW_HEADERS,
      )
      if (context.req.header('Access-Control-Request-Private-Network') === 'true')
        headers.set('Access-Control-Allow-Private-Network', 'true')

      return new Response(null, {
        status: 204,
        headers,
      })
    }

    await next()
    applyCorsHeaders(context.res.headers, context.req.header('origin'), allowedOrigins)
  })

  registerProxyRoutes(app, options.routes, fetchImpl, allowedOrigins)

  return app
}
