import type { ReadonlyURLSearchParams } from 'next/navigation'
import { OAUTH_AUTHORIZE_PENDING_KEY, REDIRECT_URL_KEY } from '@/app/account/oauth/authorize/constants'

const getCurrentUnixTimestamp = () => Math.floor(Date.now() / 1000)

function getOAuthPendingRedirect(): string | null {
  const itemStr = localStorage.getItem(OAUTH_AUTHORIZE_PENDING_KEY)
  if (!itemStr)
    return null

  try {
    const item = JSON.parse(itemStr)
    localStorage.removeItem(OAUTH_AUTHORIZE_PENDING_KEY)
    if (!item?.value)
      return null

    return getCurrentUnixTimestamp() > item.expiry ? null : item.value
  }
  catch {
    return null
  }
}

export const resolvePostLoginRedirect = (searchParams: ReadonlyURLSearchParams) => {
  const redirectUrl = searchParams.get(REDIRECT_URL_KEY)
  if (redirectUrl) {
    try {
      localStorage.removeItem(OAUTH_AUTHORIZE_PENDING_KEY)
      return decodeURIComponent(redirectUrl)
    }
    catch (e) {
      console.error('Failed to decode redirect URL:', e)
      return redirectUrl
    }
  }

  return getOAuthPendingRedirect()
}
