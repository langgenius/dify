'use client'

import { useSyncExternalStore } from 'react'
import { usePathname, useSearchParams } from '@/next/navigation'
import { parseWebAppAddress, removeWebAppBasePath } from '@/service/webapp-address'
import { basePath } from '@/utils/var'
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
  const prefix = basePath.replace(/\/$/, '')
  const fullPathname =
    prefix && pathname !== prefix && !pathname.startsWith(`${prefix}/`)
      ? `${prefix}${pathname}`
      : pathname
  const currentPath = query ? `${fullPathname}?${query}` : fullPathname
  const signInParams = new URLSearchParams({ redirect_url: currentPath })
  const location = useSyncExternalStore(subscribeToLocation, getClientLocation, getServerLocation)
  const address = parseWebAppAddress(pathname)
  if (address?.kind === 'default') {
    signInParams.set(
      'redirect_url',
      `${removeWebAppBasePath(fullPathname)}${query ? `?${query}` : ''}`,
    )
    if (location) {
      const currentUrl = new URL(currentPath, location)
      currentUrl.hash = new URL(location).hash
      signInParams.set(
        'redirect_url',
        `${removeWebAppBasePath(currentUrl.pathname)}${currentUrl.search}${currentUrl.hash}`,
      )
    }
    signInParams.set('is_end_user', '1')
    const consoleWebUrl = entry && 'parameters' in entry ? entry.parameters.console_web_url : prefix
    const loginBase = `${consoleWebUrl}/signin`
    const loginUrl = new URL(loginBase, location || 'https://signin.invalid')
    signInParams.forEach((value, key) => loginUrl.searchParams.set(key, value))
    return !location && loginBase.startsWith('/') && !loginBase.startsWith('//')
      ? `${loginUrl.pathname}${loginUrl.search}${loginUrl.hash}`
      : loginUrl.href
  }
  if (address?.kind === 'environment') return `${prefix}/webapp-signin?${signInParams.toString()}`

  return `${prefix}/signin?${signInParams.toString()}`
}
