'use client'

import { useSyncExternalStore } from 'react'
import { MAIN_NAV_DESKTOP_MEDIA_QUERY } from './responsive-classes'

const getDesktopMediaQuery = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  return window.matchMedia(MAIN_NAV_DESKTOP_MEDIA_QUERY)
}

const subscribeToDesktopViewport = (onStoreChange: () => void) => {
  const desktopMediaQuery = getDesktopMediaQuery()
  if (!desktopMediaQuery) return () => {}

  const handleChange = () => onStoreChange()
  desktopMediaQuery.addEventListener('change', handleChange)
  return () => desktopMediaQuery.removeEventListener('change', handleChange)
}

const getDesktopViewportSnapshot = () => getDesktopMediaQuery()?.matches ?? true
const getDesktopViewportServerSnapshot = () => true

export function useIsMainNavDesktopViewport() {
  return useSyncExternalStore(
    subscribeToDesktopViewport,
    getDesktopViewportSnapshot,
    getDesktopViewportServerSnapshot,
  )
}
