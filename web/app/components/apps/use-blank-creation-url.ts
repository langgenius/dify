'use client'

import type { AppType } from './app-type'
import { useEffect, useEffectEvent } from 'react'
import { basePath } from '@/utils/var'
import { createAppPath, getCreateAppHref } from './query-params'

// Blank creation owns `/apps/create`. Over the Studio list it is a shallow URL, so
// the list stays mounted under the dialog; loaded directly, the route renders it.

const isAtBlankCreationUrl = () => window.location.pathname === `${basePath}${createAppPath}`

export function enterBlankCreationUrl(mode?: AppType) {
  window.history.pushState(window.history.state, '', `${basePath}${getCreateAppHref(mode)}`)
}

export function leaveBlankCreationUrl() {
  if (isAtBlankCreationUrl()) window.history.back()
}

/** Calls `onLeave` when browser history moves off the blank creation URL. */
export function useLeaveBlankCreationUrl(onLeave: () => void) {
  const handleLeave = useEffectEvent(onLeave)
  useEffect(() => {
    const onPopState = () => {
      if (!isAtBlankCreationUrl()) handleLeave()
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
}
