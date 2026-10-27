'use client'

import { useSyncExternalStore } from 'react'
import { usePathname, useSearchParams } from '@/next/navigation'
import { parseWebAppAddress } from '@/service/webapp-address'
import { useWebAppEntry } from './webapp-entry'

const subscribeToLocation = (listener: () => void) => {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}
const getClientLocation = () => `${window.location.origin}${window.location.hash}`
const getServerLocation = () => undefined

export default function useSignInUrl() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const entry = useWebAppEntry()
  const query = searchParams.toString()
  const currentPath = query ? `${pathname}?${query}` : pathname
  const signInParams = new URLSearchParams({ redirect_url: currentPath })
  const location = useSyncExternalStore(subscribeToLocation, getClientLocation, getServerLocation)
  const address = parseWebAppAddress(pathname)
  if (address?.kind === 'default') {
    if (location) {
      const currentUrl = new URL(currentPath, location)
      currentUrl.hash = new URL(location).hash
      signInParams.set('redirect_url', currentUrl.href)
    }
    signInParams.set('is_end_user', '1')
    const accountLoginUrl =
      entry && 'parameters' in entry ? entry.parameters.account_login_url : null
    // The API value already includes /signin and any Console deployment prefix.
    const loginBase = accountLoginUrl || '/signin'
    const loginUrl = new URL(loginBase, location || 'https://signin.invalid')
    signInParams.forEach((value, key) => loginUrl.searchParams.set(key, value))
    return !accountLoginUrl ||
      (!location && loginBase.startsWith('/') && !loginBase.startsWith('//'))
      ? `${loginUrl.pathname}${loginUrl.search}${loginUrl.hash}`
      : loginUrl.href
  }
  if (address?.kind === 'environment') return `/webapp-signin?${signInParams.toString()}`

  return `/signin?${signInParams.toString()}`
}
