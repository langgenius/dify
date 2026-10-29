'use client'

import type { getConnectionData } from './connection-data'
import type useConnectionActions from './use-connection-actions'
import type useConnectionPreflight from './use-connection-preflight'
import { createContext, use } from 'react'

export type ConnectionsState = ReturnType<typeof getConnectionData> &
  Omit<ReturnType<typeof useConnectionActions>, 'onSelect'> &
  ReturnType<typeof useConnectionPreflight> & {
    status: 'inactive' | 'sign-in-required' | 'loading' | 'error' | 'ready'
    error: Error | null
    onConnectionChange: (nodeId: string, connectionId: string | null) => void
    hasMoreConnections: boolean
    isFetchingMoreConnections: boolean
    loadMoreConnections: () => void
    retry: () => void
  }

export const ConnectionsContext = createContext<ConnectionsState | null>(null)

export function useOptionalWebAppConnections() {
  return use(ConnectionsContext)
}

export function useWebAppConnections() {
  const connections = useOptionalWebAppConnections()
  if (!connections) throw new Error('WebAppConnectionsProvider is required.')
  return connections
}
