import { QueryClient } from '@tanstack/react-query'
import { cache } from 'react'

const STALE_TIME = 1000 * 60 * 30 // 30 minutes

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME,
      },
    },
  })
}

export const getQueryClientServer = cache(makeQueryClient)
