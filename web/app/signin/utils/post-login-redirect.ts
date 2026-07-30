import type { ReadonlyURLSearchParams } from '@/next/navigation'
import { getClientLoginFallback, resolveLoginRedirectTarget } from '@/utils/login-redirect'

const REDIRECT_URL_KEY = 'redirect_url'
const DEVICE_REDIRECT_KEY = 'dify_post_login_redirect'
const DEVICE_TTL_MS = 15 * 60 * 1000

const ALLOWED: Record<string, ReadonlySet<string>> = {
  '/device': new Set(['user_code', 'sso_verified']),
  '/account/oauth/authorize': new Set(['client_id', 'scope', 'state', 'redirect_uri']),
}

function validateDeviceRedirect(target: string): string | null {
  if (typeof window === 'undefined') return null

  try {
    const safeTarget = resolveLoginRedirectTarget(target, {
      allowSameOriginAbsolute: true,
      currentOrigin: window.location.origin,
    })
    if (!safeTarget) return null

    const url = new URL(safeTarget.href, window.location.origin)
    if (url.origin !== window.location.origin) return null
    const allowedKeys = ALLOWED[url.pathname]
    if (!allowedKeys) return null
    for (const key of url.searchParams.keys()) {
      if (!allowedKeys.has(key)) return null
    }
    return url.pathname + (url.search || '')
  } catch {
    return null
  }
}

// Persists target across full-page redirects within the same tab (social
// OAuth, SSO IdP bounce). sessionStorage is tab-scoped so concurrent
// /device tabs don't clobber each other. 15-min TTL drops stale values.
// Same-origin + exact-path whitelist prevents open-redirect.
export function setPostLoginRedirect(value: string | null) {
  if (typeof window === 'undefined') return
  if (value === null) {
    try {
      sessionStorage.removeItem(DEVICE_REDIRECT_KEY)
    } catch {}
    return
  }
  const safe = validateDeviceRedirect(value)
  if (!safe) return
  try {
    sessionStorage.setItem(DEVICE_REDIRECT_KEY, JSON.stringify({ target: safe, ts: Date.now() }))
  } catch {}
}

function getDeviceRedirect(): string | null {
  if (typeof window === 'undefined') return null
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(DEVICE_REDIRECT_KEY)
    sessionStorage.removeItem(DEVICE_REDIRECT_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed?.target !== 'string' || typeof parsed?.ts !== 'number') return null
    if (Date.now() - parsed.ts > DEVICE_TTL_MS) return null
    return validateDeviceRedirect(parsed.target)
  } catch {
    return null
  }
}

export function resolvePostLoginRedirect(searchParams?: ReadonlyURLSearchParams) {
  const currentOrigin = typeof window === 'undefined' ? undefined : window.location.origin
  const fallback = getClientLoginFallback()

  if (searchParams?.has(REDIRECT_URL_KEY)) {
    return (
      resolveLoginRedirectTarget(searchParams.get(REDIRECT_URL_KEY), {
        allowSameOriginAbsolute: true,
        currentOrigin,
      }) ?? fallback
    )
  }

  const device = getDeviceRedirect()
  if (device) return { kind: 'internal' as const, href: device }
  return fallback
}
