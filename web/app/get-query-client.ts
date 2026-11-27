import { defaultShouldDehydrateQuery, environmentManager, QueryClient } from '@tanstack/react-query'
import { createMutationInvalidation } from '@/service/console/mutation-invalidation'
import { createErrorToastCaches } from './query-error-toast'

const STALE_TIME = 1000 * 60 * 5

function makeQueryClient() {
  // Request errors are reported once at the cache, not by the transport; the server has no toasts.
  const isServer = environmentManager.isServer()
  // A successful write refreshes its domain's queries in the background; the server has none.
  const invalidation = isServer ? undefined : createMutationInvalidation()
  const client = new QueryClient({
    ...(invalidation
      ? createErrorToastCaches({ onMutationSuccess: invalidation.onMutationSuccess })
      : {}),
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME,
      },
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
        shouldRedactErrors: () => false,
      },
    },
  })
  invalidation?.attach(client)
  return client
}

let browserQueryClient: QueryClient | undefined

export function getQueryClient() {
  if (environmentManager.isServer()) return makeQueryClient()
  if (!browserQueryClient) browserQueryClient = makeQueryClient()
  return browserQueryClient
}
