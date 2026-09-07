import type { LoginRedirectTarget } from '@/utils/login-redirect'
import { resolveServerConsoleApiUrl } from '@/service/server'
import { getServerLoginFallback, resolveLoginRedirectTarget } from '@/utils/login-redirect'
import { ACCESS_TOKEN_COOKIE_NAME, API_PREFIX, REFRESH_TOKEN_COOKIE_NAME } from '@/config'
import { basePath } from '@/utils/var'

const REFRESH_TOKEN_PATH = '/refresh-token'
const AUTH_REFRESH_PATH = `${basePath}/auth/refresh`
const INTERNAL_PATH_PARSE_BASE = 'https://login-redirect.invalid'

function normalizeRoutePathname(pathname: string) {
  let decodedPathname = pathname
  for (let decodeCount = 0; decodeCount < 2; decodeCount += 1) {
    try {
      const nextPathname = decodeURIComponent(decodedPathname)
      if (nextPathname === decodedPathname) break
      decodedPathname = nextPathname
    } catch {
      break
    }
  }

  const collapsedPathname = decodedPathname.replace(/\/{2,}/g, '/')
  if (collapsedPathname === '/') return collapsedPathname
  return collapsedPathname.replace(/\/+$/, '')
}

const addBasePathToInternalTarget = (target: LoginRedirectTarget): LoginRedirectTarget => {
  if (!basePath || target.kind !== 'internal') return target

  const targetUrl = new URL(target.href, INTERNAL_PATH_PARSE_BASE)
  if (targetUrl.pathname === basePath || targetUrl.pathname.startsWith(`${basePath}/`))
    return target

  return { kind: 'internal', href: `${basePath}${target.href}` }
}

const resolveSafeRedirectTarget = (request: Request): LoginRedirectTarget => {
  const requestUrl = new URL(request.url)
  const redirectUrl = requestUrl.searchParams.get('redirect_url')
  const fallback = getServerLoginFallback(basePath)

  if (!redirectUrl) return fallback

  const target = resolveLoginRedirectTarget(redirectUrl, {
    allowSameOriginAbsolute: false,
  })
  if (!target) return fallback

  const normalizedTarget = addBasePathToInternalTarget(target)
  const targetUrl = new URL(normalizedTarget.href, INTERNAL_PATH_PARSE_BASE)
  if (normalizeRoutePathname(targetUrl.pathname) === normalizeRoutePathname(AUTH_REFRESH_PATH))
    return fallback

  return normalizedTarget
}

const getSetCookieHeaders = (headers: Headers) => {
  const getSetCookie = Reflect.get(headers, 'getSetCookie')

  if (typeof getSetCookie === 'function') {
    const values: unknown = getSetCookie.call(headers)
    return Array.isArray(values)
      ? values.filter((value): value is string => typeof value === 'string')
      : []
  }

  const setCookie = headers.get('set-cookie')
  return setCookie ? [setCookie] : []
}

const createRedirectResponse = (pathname: string, setCookies: string[] = []) => {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    Location: pathname,
  })

  for (const cookie of setCookies) headers.append('Set-Cookie', cookie)

  return new Response(null, {
    status: 303,
    headers,
  })
}

// Expire the unusable pair so the next request to a guarded page skips this handler
// entirely and goes straight to /signin. Without this the caller keeps arriving here
// with the same dead cookies, which is what sustained the sign-in redirect loop.
const buildExpiredAuthCookies = () => {
  // Must mirror the attributes the backend sets in api/libs/token.py: Path is always "/"
  // (not basePath), and Secure tracks the scheme. A `__Host-`prefixed cookie is rejected
  // outright by browsers unless it carries Secure and Path=/, so the pair has to match.
  const attrs = ['Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax']
  if (API_PREFIX.startsWith('https://')) attrs.push('Secure')
  const suffix = attrs.join('; ')

  return [
    `${REFRESH_TOKEN_COOKIE_NAME()}=; ${suffix}`,
    `${ACCESS_TOKEN_COOKIE_NAME()}=; ${suffix}`,
  ]
}

const createSigninRedirectResponse = (redirectTarget: LoginRedirectTarget) =>
  createRedirectResponse(
    `${basePath}/signin?redirect_url=${encodeURIComponent(redirectTarget.href)}`,
    buildExpiredAuthCookies(),
  )

export async function GET(request: Request) {
  const redirectTarget = resolveSafeRedirectTarget(request)
  const refreshUrl = resolveServerConsoleApiUrl(REFRESH_TOKEN_PATH)
  const cookie = request.headers.get('cookie')

  if (!refreshUrl || !cookie) return createSigninRedirectResponse(redirectTarget)

  try {
    const response = await fetch(refreshUrl, {
      method: 'POST',
      headers: new Headers({
        'Content-Type': 'application/json',
        cookie,
      }),
      cache: 'no-store',
    })

    if (!response.ok) return createSigninRedirectResponse(redirectTarget)

    return createRedirectResponse(redirectTarget.href, getSetCookieHeaders(response.headers))
  } catch {
    return createSigninRedirectResponse(redirectTarget)
  }
}
