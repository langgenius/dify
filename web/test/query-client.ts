import type { QueryFunction } from '@tanstack/react-query'
import { QueryClient } from '@tanstack/react-query'
import { createRequestErrorCaches } from '@/app/get-query-client'

export const createTestQueryClient = (queryFn?: QueryFunction) =>
  new QueryClient({
    ...createRequestErrorCaches(),
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Number.POSITIVE_INFINITY,
        staleTime: Number.POSITIVE_INFINITY,
        ...(queryFn && { queryFn }),
      },
      mutations: {
        retry: false,
      },
    },
  })
