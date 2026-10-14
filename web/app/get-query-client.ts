import {
  defaultShouldDehydrateQuery,
  environmentManager,
  MutationCache,
  QueryCache,
  QueryClient,
} from '@tanstack/react-query'
import { toastRequestError } from '@/app/notifications/request-error'

const STALE_TIME = 1000 * 60 * 5

/** Global failure notifications, shared with test clients so they behave like the app. */
export function createRequestErrorCaches() {
  return {
    // Global cache callbacks run once per failed request and cannot be overridden per call site.
    queryCache: new QueryCache({
      onError: (error, query) => {
        // A failed first load leaves nothing to show, so its component renders the error instead.
        // A failed background refetch keeps the stale data on screen and only needs a notice.
        if (query.state.data === undefined && !query.meta?.errorMessage) return
        toastRequestError(error, query.meta?.errorMessage)
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _onMutateResult, mutation) => {
        // A mutation that declares its own onError owns the feedback for its failures.
        if (mutation.options.onError) return
        toastRequestError(error, mutation.meta?.errorMessage)
      },
    }),
  }
}

function makeQueryClient() {
  return new QueryClient({
    ...createRequestErrorCaches(),
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
}

let browserQueryClient: QueryClient | undefined

export function getQueryClient() {
  if (environmentManager.isServer()) return makeQueryClient()
  if (!browserQueryClient) browserQueryClient = makeQueryClient()
  return browserQueryClient
}
