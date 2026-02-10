import type { ReadonlyURLSearchParams } from 'next/navigation'
import { OAUTH_AUTHORIZE_PENDING_KEY, REDIRECT_URL_KEY } from '@/app/account/oauth/authorize/constants'
import { storage } from '@/utils/storage'

const getCurrentUnixTimestamp = () => Math.floor(Date.now() / 1000)
type OAuthPendingRedirect = {
  value?: string
  expiry?: number
}

function removeOAuthPendingRedirect() {
  storage.remove(OAUTH_AUTHORIZE_PENDING_KEY)
}

function getOAuthPendingRedirect(): string | null {
  const item = storage.get<OAuthPendingRedirect>(OAUTH_AUTHORIZE_PENDING_KEY)
  if (!item)
    return null

  removeOAuthPendingRedirect()
  if (!item.value || typeof item.expiry !== 'number')
    return null

  return getCurrentUnixTimestamp() > item.expiry ? null : item.value
}

export const resolvePostLoginRedirect = (searchParams: ReadonlyURLSearchParams) => {
  const redirectUrl = searchParams.get(REDIRECT_URL_KEY)
  if (redirectUrl) {
    try {
      removeOAuthPendingRedirect()
      return decodeURIComponent(redirectUrl)
    }
    catch (e) {
      console.error('Failed to decode redirect URL:', e)
      return redirectUrl
    }
  }

  return getOAuthPendingRedirect()
}
