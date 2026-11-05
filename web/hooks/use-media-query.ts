'use client'
import { useCallback, useSyncExternalStore } from 'react'

// Same thresholds as Tailwind's `sm` (40rem) and `md` (48rem), so JS agrees with `max-sm:` / `max-md:`.
export const MOBILE_MEDIA_QUERY = '(width < 40rem)'
export const BELOW_DESKTOP_MEDIA_QUERY = '(width < 48rem)'

const getServerSnapshot = () => false

export const useMediaQuery = (query: string): boolean => {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mediaQueryList = window.matchMedia(query)
      mediaQueryList.addEventListener('change', onStoreChange)
      return () => mediaQueryList.removeEventListener('change', onStoreChange)
    },
    [query],
  )
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export const useIsMobile = () => useMediaQuery(MOBILE_MEDIA_QUERY)

export const useIsBelowDesktop = () => useMediaQuery(BELOW_DESKTOP_MEDIA_QUERY)
