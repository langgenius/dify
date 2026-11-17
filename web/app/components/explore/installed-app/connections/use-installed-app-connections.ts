'use client'

import type { InstalledAppConnectionsState } from './provider'
import { createContext, use } from 'react'

export const InstalledAppConnectionsContext = createContext<InstalledAppConnectionsState | null>(
  null,
)

export function useOptionalInstalledAppConnections() {
  return use(InstalledAppConnectionsContext)
}

export function useInstalledAppConnections() {
  const state = useOptionalInstalledAppConnections()
  if (!state) throw new Error('InstalledAppConnectionsProvider is required.')
  return state
}
