import { OAUTH_AUTHORIZE_PENDING_KEY, REDIRECT_URL_KEY } from '@/app/account/oauth/authorize/constants'
import dayjs from 'dayjs'
import type { ReadonlyURLSearchParams } from 'next/navigation'

function getItemWithExpiry(key: string): string | null {
  const itemStr = localStorage.getItem(key)
  if (!itemStr)
    return null

  try {
    const item = JSON.parse(itemStr)
    localStorage.removeItem(key)
    if (!item?.value) return null

    return dayjs().unix() > item.expiry ? null : item.value
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

  return getItemWithExpiry(OAUTH_AUTHORIZE_PENDING_KEY)
}
