import type { ReadonlyURLSearchParams } from '@/next/navigation'

const OAUTH_AUTHORIZE_PENDING_KEY = 'oauth_authorize_pending_redirect'
const REDIRECT_URL_KEY = 'redirect_url'
const DEVICE_REDIRECT_KEY = 'dify_post_login_redirect'
const DEVICE_TTL_MS = 15 * 60 * 1000

const ALLOWED: Record<string, ReadonlySet<string>> = {
  '/device': new Set(['user_code', 'sso_verified']),
  '/account/oauth/authorize': new Set(['client_id', 'scope', 'state', 'redirect_uri']),
}

type OAuthPendingRedirect = {
  value?: string
  expiry?: number
}

const getCurrentUnixTimestamp = () => Math.floor(Date.now() / 1000)

function validate(target: string): string | null {
  if (typeof window === 'undefined')
    return null
  try {
    const url = new URL(target, window.location.origin)
    if (url.origin !== window.location.origin)
      return null
    const allowedKeys = ALLOWED[url.pathname]
    if (!allowedKeys)
      return null
    for (const key of url.searchParams.keys()) {
      if (!allowedKeys.has(key))
        return null
    }
    return url.pathname + (url.search || '')
  }
  catch {
    return null
  }
}

// Persists target across full-page redirects within the same tab (social
// OAuth, SSO IdP bounce). sessionStorage is tab-scoped so concurrent
// /device tabs don't clobber each other. 15-min TTL drops stale values.
// Same-origin + exact-path whitelist prevents open-redirect.
export const setPostLoginRedirect = (value: string | null) => {
  if (typeof window === 'undefined')
    return
  if (value === null) {
    try {
      sessionStorage.removeItem(DEVICE_REDIRECT_KEY)
    }
    catch {}
    return
  }
  const safe = validate(value)
  if (!safe)
    return
  try {
    sessionStorage.setItem(DEVICE_REDIRECT_KEY, JSON.stringify({ target: safe, ts: Date.now() }))
  }
  catch {}
}

function getDeviceRedirect(): string | null {
  if (typeof window === 'undefined')
    return null
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(DEVICE_REDIRECT_KEY)
    sessionStorage.removeItem(DEVICE_REDIRECT_KEY)
  }
  catch {
    return null
  }
  if (!raw)
    return null
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed?.target !== 'string' || typeof parsed?.ts !== 'number')
      return null
    if (Date.now() - parsed.ts > DEVICE_TTL_MS)
      return null
    return validate(parsed.target)
  }
  catch {
    return null
  }
}

function removeOAuthPendingRedirect() {
  try {
    localStorage.removeItem(OAUTH_AUTHORIZE_PENDING_KEY)
  }
  catch {}
}

function getOAuthPendingRedirect(): string | null {
  try {
    const raw = localStorage.getItem(OAUTH_AUTHORIZE_PENDING_KEY)
    if (!raw)
      return null
    removeOAuthPendingRedirect()
    const item: OAuthPendingRedirect = JSON.parse(raw)
    if (!item.value || typeof item.expiry !== 'number')
      return null
    return getCurrentUnixTimestamp() > item.expiry ? null : item.value
  }
  catch {
    removeOAuthPendingRedirect()
    return null
  }
}

export function setOAuthPendingRedirect(url: string, ttlSeconds: number = 300) {
  try {
    const item: OAuthPendingRedirect = {
      value: url,
      expiry: getCurrentUnixTimestamp() + ttlSeconds,
    }
    localStorage.setItem(OAUTH_AUTHORIZE_PENDING_KEY, JSON.stringify(item))
  }
  catch {}
}

export const resolvePostLoginRedirect = (searchParams?: ReadonlyURLSearchParams) => {
  if (searchParams) {
    const redirectUrl = searchParams.get(REDIRECT_URL_KEY)
    if (redirectUrl) {
      try {
        removeOAuthPendingRedirect()
        return decodeURIComponent(redirectUrl)
      }
      catch {
        removeOAuthPendingRedirect()
        return redirectUrl
      }
    }
  }
  const device = getDeviceRedirect()
  if (device)
    return device
  return getOAuthPendingRedirect()
}
