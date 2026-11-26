import type { QueryFunction } from '@tanstack/react-query'
import type { createErrorToastCaches } from '@/app/query-error-toast'
import { QueryClient } from '@tanstack/react-query'

type TestQueryClientOptions = {
  /**
   * Pass `createErrorToastCaches()` to report request errors through the app's cache-level toasts.
   * Specs import it themselves so this helper keeps no runtime dependency on app modules.
   */
  caches?: ReturnType<typeof createErrorToastCaches>
}

export const createTestQueryClient = (
  queryFn?: QueryFunction,
  { caches }: TestQueryClientOptions = {},
) =>
  new QueryClient({
    ...caches,
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
