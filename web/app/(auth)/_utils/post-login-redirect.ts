import type { ReadonlyURLSearchParams } from '@/next/navigation'

const OAUTH_AUTHORIZE_PENDING_KEY = 'oauth_authorize_pending_redirect'
const REDIRECT_URL_KEY = 'redirect_url'
const AUTH_FLOW_SEARCH_PARAM_KEYS = [
  'email',
  'token',
  'invite_token',
  'invitation_code',
  'message',
  REDIRECT_URL_KEY,
] as const
const POST_LOGIN_REDIRECT_DENY_PATHS = [
  '/signin',
  '/signup',
  '/forgot-password',
  '/reset-password',
] as const

type OAuthPendingRedirect = {
  value?: string
  expiry?: number
}

const getCurrentUnixTimestamp = () => Math.floor(Date.now() / 1000)

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

const getCurrentOrigin = () => {
  if (typeof globalThis.location !== 'undefined')
    return globalThis.location.origin
  if (typeof window !== 'undefined')
    return window.location.origin
  return 'http://localhost'
}

export const sanitizePostLoginRedirect = (redirectUrl?: string | null) => {
  if (!redirectUrl)
    return null

  try {
    const url = new URL(redirectUrl, getCurrentOrigin())
    if (url.origin !== getCurrentOrigin())
      return null
    if (POST_LOGIN_REDIRECT_DENY_PATHS.some(path => url.pathname === path || url.pathname.startsWith(`${path}/`)))
      return null
    return `${url.pathname}${url.search}${url.hash}`
  }
  catch {
    return null
  }
}

export const createAuthSearchParams = (searchParams?: URLSearchParams | ReadonlyURLSearchParams | null) => {
  const params = new URLSearchParams()
  if (!searchParams)
    return params

  AUTH_FLOW_SEARCH_PARAM_KEYS.forEach((key) => {
    const values = searchParams.getAll(key)
    values.forEach(value => params.append(key, value))
  })
  return params
}

export const resolvePostLoginRedirect = (searchParams?: ReadonlyURLSearchParams) => {
  if (searchParams) {
    const redirectUrl = searchParams.get(REDIRECT_URL_KEY)
    if (redirectUrl) {
      try {
        removeOAuthPendingRedirect()
        return sanitizePostLoginRedirect(decodeURIComponent(redirectUrl))
      }
      catch {
        removeOAuthPendingRedirect()
        return sanitizePostLoginRedirect(redirectUrl)
      }
    }
  }
  return sanitizePostLoginRedirect(getOAuthPendingRedirect())
}
