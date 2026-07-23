import type { QueryClient } from '@tanstack/react-query'
import type { SystemFeatures } from './config'
import {
  defaultShouldDehydrateQuery,
  dehydrate,
  hashKey,
  queryOptions,
} from '@tanstack/react-query'
import {
  getServerConsoleClientContext,
  serverConsoleClient,
  serverConsoleQuery,
} from '@/service/server'
import { defaultSystemFeatures } from './config'

export const serverSystemFeaturesQueryOptions = () => {
  return queryOptions<SystemFeatures>({
    queryKey: serverConsoleQuery.systemFeatures.get.queryKey(),
    queryFn: async () => {
      try {
        return await serverConsoleClient.systemFeatures.get(undefined, {
          context: await getServerConsoleClientContext(),
        })
      } catch (err) {
        console.error('[systemFeatures] server fetch failed', err)
        return defaultSystemFeatures
      }
    },
  })
}

export const dehydrateSystemFeatures = (queryClient: QueryClient) => {
  const queryHash = hashKey(serverSystemFeaturesQueryOptions().queryKey)

  return dehydrate(queryClient, {
    shouldDehydrateQuery: (query) =>
      query.queryHash === queryHash && defaultShouldDehydrateQuery(query),
  })
}
