import type { QueryFunction } from '@tanstack/react-query'
import { QueryClient } from '@tanstack/react-query'
import { notifyError } from '@/app/notifications/notify-error'

export const createTestQueryClient = (queryFn?: QueryFunction) =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Number.POSITIVE_INFINITY,
        staleTime: Number.POSITIVE_INFINITY,
        ...(queryFn && { queryFn }),
      },
      mutations: {
        retry: false,
        onError: notifyError,
      },
    },
  })
