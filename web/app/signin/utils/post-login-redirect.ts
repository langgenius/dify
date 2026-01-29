import type { ReadonlyURLSearchParams } from 'next/navigation'
import dayjs from 'dayjs'
import { REDIRECT_URL_KEY } from '@/app/account/oauth/authorize/constants'
import { STORAGE_KEYS } from '@/config/storage-keys'
import { storage } from '@/utils/storage'

function getItemWithExpiry(key: string): string | null {
  const itemStr = storage.get<string>(key)
  if (!itemStr)
    return null

  try {
    const item = JSON.parse(itemStr)
    storage.remove(key)
    if (!item?.value)
      return null

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
      storage.remove(STORAGE_KEYS.AUTH.OAUTH_AUTHORIZE_PENDING)
      return decodeURIComponent(redirectUrl)
    }
    catch (e) {
      console.error('Failed to decode redirect URL:', e)
      return redirectUrl
    }
  }

  return getItemWithExpiry(STORAGE_KEYS.AUTH.OAUTH_AUTHORIZE_PENDING)
}
