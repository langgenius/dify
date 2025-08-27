import { OAUTH_AUTHORIZE_PENDING_KEY, REDIRECT_URL_KEY } from '@/app/account/oauth/authorize/page'
import type { ReadonlyURLSearchParams } from 'next/navigation'

export const resolvePostLoginRedirect = (searchParams: ReadonlyURLSearchParams) => {
  const redirectUrl = searchParams.get(REDIRECT_URL_KEY)
  if (redirectUrl)
    return decodeURIComponent(redirectUrl)

  try {
    const pendingStr = localStorage.getItem(OAUTH_AUTHORIZE_PENDING_KEY)
    if (pendingStr) {
      const pending = JSON.parse(pendingStr)
      localStorage.removeItem(OAUTH_AUTHORIZE_PENDING_KEY)
      return pending?.returnUrl
    }
  }
  catch { }
  return null
}
