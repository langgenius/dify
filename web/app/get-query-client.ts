import { defaultShouldDehydrateQuery, environmentManager, QueryClient } from '@tanstack/react-query'
import { notifyError } from '@/app/notifications/error'

const STALE_TIME = 1000 * 60 * 5

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: {
        onError: notifyError,
      },
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
}

let browserQueryClient: QueryClient | undefined

export function getQueryClient() {
  if (environmentManager.isServer()) return makeQueryClient()
  if (!browserQueryClient) browserQueryClient = makeQueryClient()
  return browserQueryClient
}
