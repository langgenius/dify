const DEFAULT_PROXY_TARGET = 'https://cloud.dify.ai'

const SECURE_COOKIE_PREFIX_PATTERN = /^__(Host|Secure)-/
const SAME_SITE_NONE_PATTERN = /^samesite=none$/i
const COOKIE_PATH_PATTERN = /^path=/i
const COOKIE_DOMAIN_PATTERN = /^domain=/i
const COOKIE_SECURE_PATTERN = /^secure$/i
const COOKIE_PARTITIONED_PATTERN = /^partitioned$/i

const HOST_PREFIX_COOKIE_NAMES = new Set([
  'access_token',
  'csrf_token',
  'refresh_token',
  'webapp_access_token',
])

const isPassportCookie = (cookieName: string) => cookieName.startsWith('passport-')

const shouldUseHostPrefix = (cookieName: string) => {
  const normalizedCookieName = cookieName.replace(SECURE_COOKIE_PREFIX_PATTERN, '')
  return HOST_PREFIX_COOKIE_NAMES.has(normalizedCookieName) || isPassportCookie(normalizedCookieName)
}

const toUpstreamCookieName = (cookieName: string) => {
  if (cookieName.startsWith('__Host-'))
    return cookieName

  if (cookieName.startsWith('__Secure-'))
    return `__Host-${cookieName.replace(SECURE_COOKIE_PREFIX_PATTERN, '')}`

  if (!shouldUseHostPrefix(cookieName))
    return cookieName

  return `__Host-${cookieName}`
}

const toLocalCookieName = (cookieName: string) => cookieName.replace(SECURE_COOKIE_PREFIX_PATTERN, '')

export const rewriteCookieHeaderForUpstream = (cookieHeader?: string) => {
  if (!cookieHeader)
    return cookieHeader

  return cookieHeader
    .split(/;\s*/)
    .filter(Boolean)
    .map((cookie) => {
      const separatorIndex = cookie.indexOf('=')
      if (separatorIndex === -1)
        return cookie

      const cookieName = cookie.slice(0, separatorIndex).trim()
      const cookieValue = cookie.slice(separatorIndex + 1)
      return `${toUpstreamCookieName(cookieName)}=${cookieValue}`
    })
    .join('; ')
}

const rewriteSetCookieValueForLocal = (setCookieValue: string) => {
  const [rawCookiePair, ...rawAttributes] = setCookieValue.split(';')
  const separatorIndex = rawCookiePair.indexOf('=')

  if (separatorIndex === -1)
    return setCookieValue

  const cookieName = rawCookiePair.slice(0, separatorIndex).trim()
  const cookieValue = rawCookiePair.slice(separatorIndex + 1)
  const rewrittenAttributes = rawAttributes
    .map(attribute => attribute.trim())
    .filter(attribute =>
      !COOKIE_DOMAIN_PATTERN.test(attribute)
      && !COOKIE_SECURE_PATTERN.test(attribute)
      && !COOKIE_PARTITIONED_PATTERN.test(attribute),
    )
    .map((attribute) => {
      if (SAME_SITE_NONE_PATTERN.test(attribute))
        return 'SameSite=Lax'

      if (COOKIE_PATH_PATTERN.test(attribute))
        return 'Path=/'

      return attribute
    })

  return [`${toLocalCookieName(cookieName)}=${cookieValue}`, ...rewrittenAttributes].join('; ')
}

export const rewriteSetCookieHeadersForLocal = (setCookieHeaders?: string | string[]): string[] | undefined => {
  if (!setCookieHeaders)
    return undefined

  const normalizedHeaders = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : [setCookieHeaders]

  return normalizedHeaders.map(rewriteSetCookieValueForLocal)
}

export { DEFAULT_PROXY_TARGET }
