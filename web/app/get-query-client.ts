import { defaultShouldDehydrateQuery, environmentManager, QueryClient } from '@tanstack/react-query'

export const DEFAULT_QUERY_STALE_TIME_MS = 1000 * 60 * 5

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_QUERY_STALE_TIME_MS,
      },
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
        shouldRedactErrors: () => false,
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined

export function getQueryClient() {
  if (environmentManager.isServer()) return makeQueryClient()
  if (!browserQueryClient) browserQueryClient = makeQueryClient()
  return browserQueryClient
}
