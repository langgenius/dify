import { queryOptions } from '@tanstack/react-query'
import {
  getServerConsoleClientContext,
  serverConsoleClient,
  serverConsoleQuery,
} from '@/service/server'

export const serverSystemFeaturesQueryOptions = () => {
  return queryOptions({
    queryKey: serverConsoleQuery.systemFeatures.get.queryKey(),
    queryFn: async () =>
      serverConsoleClient.systemFeatures.get(undefined, {
        context: await getServerConsoleClientContext(),
      }),
  })
}
