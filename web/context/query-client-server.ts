import { MutationCache, QueryClient } from '@tanstack/react-query'
import { cache } from 'react'
import { runOverriddenSharedMutationSuccess } from '@/service/shared-mutation-success'

const STALE_TIME = 1000 * 60 * 5 // 5 minutes

export function makeQueryClient() {
  return new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: runOverriddenSharedMutationSuccess,
    }),
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME,
      },
    },
  })
}

export const getQueryClientServer = cache(makeQueryClient)
