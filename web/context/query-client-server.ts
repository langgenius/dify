import { QueryClient } from '@tanstack/react-query'
import { cache } from 'react'

const STALE_TIME = 1000 * 60 * 5 // 5 minutes

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME,
        retry: (failureCount, error) => {
          if (error instanceof DOMException && error.name === 'AbortError')
            return false
          return failureCount < 3
        },
      },
    },
  })
}

export const getQueryClientServer = cache(makeQueryClient)
