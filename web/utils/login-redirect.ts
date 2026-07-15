export type LoginRedirectTarget =
  | { kind: 'internal'; href: string }
  | { kind: 'absolute'; href: string }

type ResolveLoginRedirectOptions = {
  currentOrigin?: string
  allowSameOriginAbsolute?: boolean
}

const CLOUD_CONSOLE_HOME = 'https://cloud.dify.ai/'
const INTERNAL_URL_BASE = 'https://login-redirect.invalid'
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/
const MALFORMED_PERCENT_PATTERN = /%(?![\dA-F]{2})/i
const HEX_CHARACTER_PATTERN = /^[\dA-F]$/i

function isSingleSlashPath(pathname: string) {
  return pathname.startsWith('/') && !pathname.startsWith('//') && !pathname.startsWith('/\\')
}

function decodePathnameLayer(pathname: string, allowLiteralPercent: boolean) {
  let decodablePathname = ''

  for (let index = 0; index < pathname.length; index += 1) {
    const character = pathname[index]
    if (character !== '%') {
      decodablePathname += character
      continue
    }

    const firstHexCharacter = pathname[index + 1]
    const secondHexCharacter = pathname[index + 2]
    const hasFirstHexCharacter = HEX_CHARACTER_PATTERN.test(firstHexCharacter || '')
    const hasSecondHexCharacter = HEX_CHARACTER_PATTERN.test(secondHexCharacter || '')

    if (hasFirstHexCharacter && hasSecondHexCharacter) {
      decodablePathname += pathname.slice(index, index + 3)
      index += 2
      continue
    }

    if (!allowLiteralPercent || hasFirstHexCharacter) return null
    decodablePathname += '%25'
  }

  try {
    return decodeURIComponent(decodablePathname)
  } catch {
    return null
  }
}

function hasSafePathname(pathname: string) {
  let decodedPathname = pathname

  for (let decodeCount = 0; decodeCount <= 2; decodeCount += 1) {
    if (
      !isSingleSlashPath(decodedPathname) ||
      decodedPathname.includes('\\') ||
      CONTROL_CHARACTER_PATTERN.test(decodedPathname)
    )
      return false

    try {
      const normalizedUrl = new URL(decodedPathname, INTERNAL_URL_BASE)
      if (
        normalizedUrl.origin !== INTERNAL_URL_BASE ||
        !isSingleSlashPath(normalizedUrl.pathname) ||
        normalizedUrl.pathname.includes('\\')
      )
        return false
    } catch {
      return false
    }

    if (decodeCount === 2) return true

    const nextPathname = decodePathnameLayer(decodedPathname, decodeCount > 0)
    if (nextPathname === null) return false
    if (nextPathname === decodedPathname) return true
    decodedPathname = nextPathname
  }

  return false
}

function getHTTPOrigin(value: string | undefined) {
  if (!value) return null

  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

function isTrustedDifyHostname(hostname: string) {
  return hostname === 'dify.ai' || hostname.endsWith('.dify.ai')
}

function validateLoginRedirectTarget(
  candidate: string,
  options: ResolveLoginRedirectOptions,
): LoginRedirectTarget | null {
  if (
    candidate.length === 0 ||
    candidate !== candidate.trim() ||
    CONTROL_CHARACTER_PATTERN.test(candidate) ||
    MALFORMED_PERCENT_PATTERN.test(candidate) ||
    candidate.includes('\\')
  )
    return null

  if (candidate.startsWith('/')) {
    if (!isSingleSlashPath(candidate)) return null

    try {
      const url = new URL(candidate, INTERNAL_URL_BASE)
      if (url.origin !== INTERNAL_URL_BASE || !hasSafePathname(url.pathname)) return null

      const href = `${url.pathname}${url.search}${url.hash}`
      if (!isSingleSlashPath(href)) return null
      return { kind: 'internal', href }
    } catch {
      return null
    }
  }

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    !hasSafePathname(url.pathname)
  )
    return null

  const currentOrigin = getHTTPOrigin(options.currentOrigin)
  if (options.allowSameOriginAbsolute && currentOrigin && url.origin === currentOrigin)
    return { kind: 'absolute', href: url.href }

  if (url.protocol !== 'https:' || url.port !== '' || !isTrustedDifyHostname(url.hostname))
    return null

  return { kind: 'absolute', href: url.href }
}

function normalizeBasePath(value: string) {
  if (!value || value === '/') return ''
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`
  return withLeadingSlash.replace(/\/+$/, '')
}

export function resolveLoginRedirectTarget(
  raw: string | null | undefined,
  options: ResolveLoginRedirectOptions = {},
): LoginRedirectTarget | null {
  if (!raw) return null

  const target = validateLoginRedirectTarget(raw, options)
  if (target) return target

  try {
    const decodedTarget = decodeURIComponent(raw)
    if (decodedTarget === raw) return null
    return validateLoginRedirectTarget(decodedTarget, options)
  } catch {
    return null
  }
}

export function getClientLoginFallback(isCloudEdition: boolean): LoginRedirectTarget {
  if (isCloudEdition) return { kind: 'absolute', href: CLOUD_CONSOLE_HOME }
  return { kind: 'internal', href: '/' }
}

export function getServerLoginFallback(
  isCloudEdition: boolean,
  basePath: string,
): LoginRedirectTarget {
  if (isCloudEdition) return { kind: 'absolute', href: CLOUD_CONSOLE_HOME }

  const normalizedBasePath = normalizeBasePath(basePath)
  return { kind: 'internal', href: normalizedBasePath ? `${normalizedBasePath}/` : '/' }
}
