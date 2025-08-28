import { OAUTH_AUTHORIZE_PENDING_KEY, REDIRECT_URL_KEY } from '@/app/account/oauth/authorize/page'
import type { ReadonlyURLSearchParams } from 'next/navigation'

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

  try {
    const pendingStr = localStorage.getItem(OAUTH_AUTHORIZE_PENDING_KEY)
    if (pendingStr) {
      const pending = JSON.parse(pendingStr)
      localStorage.removeItem(OAUTH_AUTHORIZE_PENDING_KEY)
      return pending?.returnUrl || null
    }
  }
  catch (e) {
    console.error('Failed to parse pending redirect info:', e)
  }

  return null
}
