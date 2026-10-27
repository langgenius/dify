'use client'

import type { getConnectionData } from './connection-data'
import { createContext, use } from 'react'

export type ConnectionsState = ReturnType<typeof getConnectionData> & {
  status: 'inactive' | 'sign-in-required' | 'loading' | 'error' | 'ready'
  error: Error | null
  onConnectionChange: (nodeId: string, connectionId: string | null) => void
  hasMoreConnections: boolean
  isFetchingMoreConnections: boolean
  loadMoreConnections: () => void
  retry: () => void
}

export const ConnectionsContext = createContext<ConnectionsState | null>(null)

export function useWebAppConnections() {
  const connections = use(ConnectionsContext)
  if (!connections) throw new Error('WebAppConnectionsProvider is required.')
  return connections
}
