import type { Context, Hono } from 'hono'
import { Hono as HonoApp } from 'hono'
import { DEFAULT_PROXY_TARGET, rewriteCookieHeaderForUpstream, rewriteSetCookieHeadersForLocal } from './cookies'

type DevProxyEnv = Partial<Record<
  | 'HONO_CONSOLE_API_PROXY_TARGET'
  | 'HONO_PUBLIC_API_PROXY_TARGET'
  | 'HONO_ENTERPRISE_API_PROXY_TARGET',
  string
>>

type DevProxyTargets = {
  consoleApiTarget: string
  publicApiTarget: string
  enterpriseApiTarget?: string
}

type DevProxyAppOptions = DevProxyTargets & {
  fetchImpl?: typeof globalThis.fetch
}

const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const ALLOW_METHODS = 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS'
const DEFAULT_ALLOW_HEADERS = 'Authorization, Content-Type, X-CSRF-Token'
const UPSTREAM_ACCEPT_ENCODING = 'identity'
const RESPONSE_HEADERS_TO_DROP = [
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'set-cookie',
  'transfer-encoding',
] as const

const ENTERPRISE_API_ROUTES = [
  '/console/api/enterprise',
  '/api/enterprise',
  '/admin-api',
  '/inner/api',
  '/mfa',
  '/scim',
  '/v1/audit',
  '/v1/dashboard',
  '/v1/healthz',
  '/v1/plugin-manager',
] as const

const CONSOLE_API_ROUTES = ['/console/api'] as const
const PUBLIC_API_ROUTES = ['/api'] as const

type ProxyRoutePath
  = | typeof ENTERPRISE_API_ROUTES[number]
    | typeof CONSOLE_API_ROUTES[number]
    | typeof PUBLIC_API_ROUTES[number]

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

export const isAllowedDevOrigin = (origin?: string | null) => {
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

const applyCorsHeaders = (headers: Headers, origin?: string | null) => {
  if (!isAllowedDevOrigin(origin))
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

const createProxyRequestHeaders = (request: Request, targetUrl: URL) => {
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.set('accept-encoding', UPSTREAM_ACCEPT_ENCODING)

  if (headers.has('origin'))
    headers.set('origin', targetUrl.origin)

  const rewrittenCookieHeader = rewriteCookieHeaderForUpstream(headers.get('cookie') || undefined, {
    useHostPrefix: targetUrl.protocol === 'https:',
  })
  if (rewrittenCookieHeader)
    headers.set('cookie', rewrittenCookieHeader)

  return headers
}

const createUpstreamResponseHeaders = (response: Response, requestOrigin?: string | null) => {
  const headers = new Headers(response.headers)
  RESPONSE_HEADERS_TO_DROP.forEach(header => headers.delete(header))

  const rewrittenSetCookies = rewriteSetCookieHeadersForLocal(response.headers.getSetCookie())
  rewrittenSetCookies?.forEach((cookie) => {
    headers.append('set-cookie', cookie)
  })

  applyCorsHeaders(headers, requestOrigin)
  return headers
}

const proxyRequest = async (
  context: Context,
  target: string,
  fetchImpl: typeof globalThis.fetch,
) => {
  const requestUrl = new URL(context.req.url)
  const targetUrl = buildUpstreamUrl(target, requestUrl.pathname, requestUrl.search)
  const requestHeaders = createProxyRequestHeaders(context.req.raw, targetUrl)
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
  const responseHeaders = createUpstreamResponseHeaders(upstreamResponse, context.req.header('origin'))

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  })
}

const registerProxyRoute = (
  app: Hono,
  path: ProxyRoutePath,
  target: string,
  fetchImpl: typeof globalThis.fetch,
) => {
  app.all(path, context => proxyRequest(context, target, fetchImpl))
  app.all(`${path}/*`, context => proxyRequest(context, target, fetchImpl))
}

const registerProxyRoutes = (
  app: Hono,
  routes: readonly ProxyRoutePath[],
  target: string,
  fetchImpl: typeof globalThis.fetch,
) => {
  routes.forEach(route => registerProxyRoute(app, route, target, fetchImpl))
}

export const resolveDevProxyTargets = (env: DevProxyEnv = {}): DevProxyTargets => {
  const consoleApiTarget = env.HONO_CONSOLE_API_PROXY_TARGET
    || DEFAULT_PROXY_TARGET
  const publicApiTarget = env.HONO_PUBLIC_API_PROXY_TARGET
    || consoleApiTarget
  const enterpriseApiTarget = env.HONO_ENTERPRISE_API_PROXY_TARGET

  return {
    consoleApiTarget,
    publicApiTarget,
    enterpriseApiTarget,
  }
}

export const createDevProxyApp = (options: DevProxyAppOptions) => {
  const app = new HonoApp()
  const fetchImpl = options.fetchImpl || globalThis.fetch

  app.onError((error, context) => {
    console.error('[dev-hono-proxy]', error)

    const headers = new Headers()
    applyCorsHeaders(headers, context.req.header('origin'))

    return new Response('Upstream proxy request failed.', {
      status: 502,
      headers,
    })
  })

  app.use('*', async (context, next) => {
    if (context.req.method === 'OPTIONS') {
      const headers = new Headers()
      applyCorsHeaders(headers, context.req.header('origin'))
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
    applyCorsHeaders(context.res.headers, context.req.header('origin'))
  })

  if (options.enterpriseApiTarget)
    registerProxyRoutes(app, ENTERPRISE_API_ROUTES, options.enterpriseApiTarget, fetchImpl)
  registerProxyRoutes(app, CONSOLE_API_ROUTES, options.consoleApiTarget, fetchImpl)
  registerProxyRoutes(app, PUBLIC_API_ROUTES, options.publicApiTarget, fetchImpl)

  return app
}
