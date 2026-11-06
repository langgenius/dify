'use client'

import { useEffect, useEffectEvent } from 'react'
import { basePath } from '@/utils/var'
import { createAppPath, createAppTemplatePath } from './query-params'

// Blank creation owns `/apps/create` and template creation `/apps/create/template`.
// Over the Studio list they are shallow URLs, so the list stays mounted under the
// dialog; loaded directly, each route renders its dialog on its own.

const creationPathnames = [createAppPath, createAppTemplatePath].map((path) => `${basePath}${path}`)
const isAtCreationUrl = () => creationPathnames.includes(window.location.pathname)

/** Moves to a creation URL, replacing the entry when switching between creation dialogs. */
export function enterCreationUrl(href: string) {
  const url = `${basePath}${href}`
  if (isAtCreationUrl()) window.history.replaceState(window.history.state, '', url)
  else window.history.pushState(window.history.state, '', url)
}

export function leaveCreationUrl() {
  if (isAtCreationUrl()) window.history.back()
}

/** Calls `onLeave` when browser history moves off the creation URLs. */
export function useLeaveCreationUrl(onLeave: () => void) {
  const handleLeave = useEffectEvent(onLeave)
  useEffect(() => {
    const onPopState = () => {
      if (!isAtCreationUrl()) handleLeave()
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
}
