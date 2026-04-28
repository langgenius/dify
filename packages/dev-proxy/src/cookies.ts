import type { CookieRewriteOptions } from './types'

const SECURE_COOKIE_PREFIX_PATTERN = /^__(Host|Secure)-/
const SAME_SITE_NONE_PATTERN = /^samesite=none$/i
const COOKIE_PATH_PATTERN = /^path=/i
const COOKIE_DOMAIN_PATTERN = /^domain=/i
const COOKIE_SECURE_PATTERN = /^secure$/i
const COOKIE_PARTITIONED_PATTERN = /^partitioned$/i

const stripSecureCookiePrefix = (cookieName: string) => cookieName.replace(SECURE_COOKIE_PREFIX_PATTERN, '')

const matchesCookieName = (cookieName: string, matcher: string | RegExp) =>
  typeof matcher === 'string'
    ? matcher === cookieName
    : matcher.test(cookieName)

const shouldUseHostPrefix = (cookieName: string, options: CookieRewriteOptions) => {
  const normalizedCookieName = stripSecureCookiePrefix(cookieName)

  return options.hostPrefixCookies?.some(matcher => matchesCookieName(normalizedCookieName, matcher)) || false
}

const toUpstreamCookieName = (cookieName: string, options: CookieRewriteOptions) => {
  if (cookieName.startsWith('__Host-'))
    return cookieName

  if (cookieName.startsWith('__Secure-'))
    return `__Host-${stripSecureCookiePrefix(cookieName)}`

  if (!shouldUseHostPrefix(cookieName, options))
    return cookieName

  return `__Host-${cookieName}`
}

export const toLocalCookieName = (cookieName: string) => stripSecureCookiePrefix(cookieName)

export const rewriteCookieHeaderForUpstream = (
  cookieHeader: string | undefined,
  options: CookieRewriteOptions & { useHostPrefix?: boolean },
) => {
  if (!cookieHeader)
    return cookieHeader

  const { useHostPrefix = true } = options

  return cookieHeader
    .split(/;\s*/)
    .filter(Boolean)
    .map((cookie) => {
      const separatorIndex = cookie.indexOf('=')
      if (separatorIndex === -1)
        return cookie

      const cookieName = cookie.slice(0, separatorIndex).trim()
      const cookieValue = cookie.slice(separatorIndex + 1)
      const upstreamCookieName = useHostPrefix
        ? toUpstreamCookieName(cookieName, options)
        : cookieName

      return `${upstreamCookieName}=${cookieValue}`
    })
    .join('; ')
}

const rewriteSetCookieValueForLocal = (setCookieValue: string) => {
  const [rawCookiePair, ...rawAttributes] = setCookieValue.split(';')
  const separatorIndex = rawCookiePair!.indexOf('=')

  if (separatorIndex === -1)
    return setCookieValue

  const cookieName = rawCookiePair!.slice(0, separatorIndex).trim()
  const cookieValue = rawCookiePair!.slice(separatorIndex + 1)
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

export const rewriteSetCookieHeadersForLocal = (setCookieHeaders: readonly string[]) =>
  setCookieHeaders.map(rewriteSetCookieValueForLocal)
