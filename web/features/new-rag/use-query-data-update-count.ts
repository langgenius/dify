'use client'

import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { hashKey } from '@tanstack/react-query'
import { useCallback, useSyncExternalStore } from 'react'

export function useQueryDataUpdateCount(queryClient: QueryClient, queryKey: QueryKey) {
  const queryHash = hashKey(queryKey)
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      queryClient.getQueryCache().subscribe((event) => {
        if (
          event.type === 'updated' &&
          event.action.type === 'success' &&
          event.query.queryHash === queryHash
        )
          onStoreChange()
      }),
    [queryClient, queryHash],
  )
  const getSnapshot = useCallback(
    () => queryClient.getQueryState(queryKey)?.dataUpdateCount ?? 0,
    [queryClient, queryKey],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
