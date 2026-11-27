import type { QueryFunction } from '@tanstack/react-query'
import type { createErrorToastCaches } from '@/app/query-error-toast'
import type { createMutationInvalidation } from '@/service/console/mutation-invalidation'
import { MutationCache, QueryClient } from '@tanstack/react-query'

type TestQueryClientOptions = {
  /**
   * Pass `createErrorToastCaches()` to report request errors through the app's cache-level toasts.
   * Specs import it themselves so this helper keeps no runtime dependency on app modules.
   * With `invalidation`, pass `createErrorToastCaches({ onMutationSuccess })` from it.
   */
  caches?: ReturnType<typeof createErrorToastCaches>
  /**
   * Pass `createMutationInvalidation()` to refresh a mutation's domain after it succeeds, like
   * the app's QueryClient does.
   */
  invalidation?: ReturnType<typeof createMutationInvalidation>
}

export const createTestQueryClient = (
  queryFn?: QueryFunction,
  { caches, invalidation }: TestQueryClientOptions = {},
) => {
  const client = new QueryClient({
    ...(caches ??
      (invalidation && {
        mutationCache: new MutationCache({
          onSuccess: (_data, _variables, _result, mutation) =>
            invalidation.onMutationSuccess(mutation),
        }),
      })),
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
  invalidation?.attach(client)
  return client
}
