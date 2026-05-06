import type { Context, Hono } from 'hono'
import type { CookieRewriteOptions, CreateDevProxyAppOptions, DevProxyCorsAllowedOrigins, DevProxyRoute } from './types'
import { Hono as HonoApp } from 'hono'
import { rewriteCookieHeaderForUpstream, rewriteSetCookieHeadersForLocal } from './cookies'

const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
const ALLOW_METHODS = 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS'
const DEFAULT_ALLOW_HEADERS = 'Authorization, Content-Type, X-CSRF-Token'
const UPSTREAM_ACCEPT_ENCODING = 'identity'
const RESPONSE_HEADERS_TO_DROP = [
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
] as const

const appendHeaderValue = (headers: Headers, name: string, value: string) => {
  const currentValue = headers.get(name)
  if (!currentValue) {
    headers.set(name, value)
    return
  }

  if (currentValue.split(',').map(item => item.trim()).includes(value))
    return

  headers.set(name, `${currentValue}, ${value}`)
}

export const isAllowedLocalDevOrigin = (origin?: string | null) => {
  if (!origin)
    return false

  try {
    const url = new URL(origin)
    return LOCAL_DEV_HOSTS.has(url.hostname)
  }
  catch {
    return false
  }
}

export const isAllowedDevOrigin = (
  origin?: string | null,
  allowedOrigins: DevProxyCorsAllowedOrigins = 'local',
) => {
  if (!origin)
    return false

  if (allowedOrigins === 'local')
    return isAllowedLocalDevOrigin(origin)

  return allowedOrigins.includes(origin)
}

const applyCorsHeaders = (
  headers: Headers,
  origin: string | undefined | null,
  allowedOrigins: DevProxyCorsAllowedOrigins = 'local',
) => {
  if (!isAllowedDevOrigin(origin, allowedOrigins))
    return

  headers.set('Access-Control-Allow-Origin', origin!)
  headers.set('Access-Control-Allow-Credentials', 'true')
  appendHeaderValue(headers, 'Vary', 'Origin')
}

export const buildUpstreamUrl = (target: string, requestPath: string, search = '') => {
  const targetUrl = new URL(target)
  const normalizedTargetPath = targetUrl.pathname === '/' ? '' : targetUrl.pathname.replace(/\/$/, '')
  const normalizedRequestPath = requestPath.startsWith('/') ? requestPath : `/${requestPath}`
  const hasTargetPrefix = normalizedTargetPath
    && (normalizedRequestPath === normalizedTargetPath || normalizedRequestPath.startsWith(`${normalizedTargetPath}/`))

  targetUrl.pathname = hasTargetPrefix
    ? normalizedRequestPath
    : `${normalizedTargetPath}${normalizedRequestPath}`
  targetUrl.search = search

  return targetUrl
}

const createProxyRequestHeaders = (
  request: Request,
  targetUrl: URL,
  cookieRewrite: CookieRewriteOptions | false | undefined,
) => {
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.set('accept-encoding', UPSTREAM_ACCEPT_ENCODING)

  if (headers.has('origin'))
    headers.set('origin', targetUrl.origin)

  if (cookieRewrite) {
    const rewrittenCookieHeader = rewriteCookieHeaderForUpstream(headers.get('cookie') || undefined, {
      ...cookieRewrite,
      useHostPrefix: targetUrl.protocol === 'https:',
    })
    if (rewrittenCookieHeader)
      headers.set('cookie', rewrittenCookieHeader)
  }

  return headers
}

const getSetCookieHeaders = (headers: Headers) => {
  const headersWithGetSetCookie = headers as Headers & { getSetCookie?: () => string[] }
  const setCookieHeaders = headersWithGetSetCookie.getSetCookie?.()
  if (setCookieHeaders?.length)
    return setCookieHeaders

  const setCookie = headers.get('set-cookie')
  return setCookie ? [setCookie] : []
}

const createUpstreamResponseHeaders = (
  response: Response,
  requestOrigin: string | undefined | null,
  allowedOrigins: DevProxyCorsAllowedOrigins,
  cookieRewrite: CookieRewriteOptions | false | undefined,
) => {
  const headers = new Headers(response.headers)
  RESPONSE_HEADERS_TO_DROP.forEach(header => headers.delete(header))
  headers.delete('set-cookie')

  const setCookieHeaders = getSetCookieHeaders(response.headers)
  const responseSetCookieHeaders = cookieRewrite
    ? rewriteSetCookieHeadersForLocal(setCookieHeaders)
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
  const requestHeaders = createProxyRequestHeaders(context.req.raw, targetUrl, route.cookieRewrite)
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

const normalizeRoutePaths = (paths: DevProxyRoute['paths']) => Array.isArray(paths) ? paths : [paths]

const registerProxyRoute = (
  app: Hono,
  route: DevProxyRoute,
  path: string,
  fetchImpl: typeof globalThis.fetch,
  allowedOrigins: DevProxyCorsAllowedOrigins,
) => {
  if (!path.startsWith('/'))
    throw new Error(`Invalid dev proxy route path "${path}". Paths must start with "/".`)

  app.all(path, context => proxyRequest(context, route, fetchImpl, allowedOrigins))
  app.all(`${path}/*`, context => proxyRequest(context, route, fetchImpl, allowedOrigins))
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
