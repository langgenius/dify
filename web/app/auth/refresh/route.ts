import { resolveServerConsoleApiUrl } from '@/service/server'
import { basePath } from '@/utils/var'

const REFRESH_TOKEN_PATH = '/refresh-token'
const AUTH_REFRESH_PATH = `${basePath}/auth/refresh`
const DEFAULT_REDIRECT_PATH = `${basePath}/apps`

const resolveSafeRedirectPath = (request: Request) => {
  const requestUrl = new URL(request.url)
  const redirectUrl = requestUrl.searchParams.get('redirect_url')

  if (!redirectUrl)
    return DEFAULT_REDIRECT_PATH

  try {
    const target = new URL(redirectUrl, requestUrl.origin)
    if (target.origin !== requestUrl.origin)
      return DEFAULT_REDIRECT_PATH
    if (target.pathname === AUTH_REFRESH_PATH)
      return DEFAULT_REDIRECT_PATH

    return `${target.pathname}${target.search}`
  }
  catch {
    return DEFAULT_REDIRECT_PATH
  }
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
    'Location': pathname,
  })

  for (const cookie of setCookies)
    headers.append('Set-Cookie', cookie)

  return new Response(null, {
    status: 303,
    headers,
  })
}

const createSigninRedirectResponse = (redirectPath: string) =>
  createRedirectResponse(`${basePath}/signin?redirect_url=${encodeURIComponent(redirectPath)}`)

export async function GET(request: Request) {
  const redirectPath = resolveSafeRedirectPath(request)
  const refreshUrl = resolveServerConsoleApiUrl(REFRESH_TOKEN_PATH)
  const cookie = request.headers.get('cookie')

  if (!refreshUrl || !cookie)
    return createSigninRedirectResponse(redirectPath)

  try {
    const response = await fetch(refreshUrl, {
      method: 'POST',
      headers: new Headers({
        'Content-Type': 'application/json',
        cookie,
      }),
      cache: 'no-store',
    })

    if (!response.ok)
      return createSigninRedirectResponse(redirectPath)

    return createRedirectResponse(redirectPath, getSetCookieHeaders(response.headers))
  }
  catch {
    return createSigninRedirectResponse(redirectPath)
  }
}
