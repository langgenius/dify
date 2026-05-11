import type { ReadonlyURLSearchParams } from '@/next/navigation'

const OAUTH_AUTHORIZE_PENDING_KEY = 'oauth_authorize_pending_redirect'
const REDIRECT_URL_KEY = 'redirect_url'

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
  return getOAuthPendingRedirect()
}
