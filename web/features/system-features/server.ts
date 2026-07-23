import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import { queryOptions } from '@tanstack/react-query'
import {
  getServerConsoleClientContext,
  serverConsoleClient,
  serverConsoleQuery,
} from '@/service/server'

const SYSTEM_FEATURES_REQUEST_TIMEOUT = 5_000

export const serverSystemFeaturesQueryOptions = () => {
  return queryOptions<GetSystemFeaturesResponse>({
    queryKey: serverConsoleQuery.systemFeatures.get.queryKey(),
    queryFn: async ({ signal }) =>
      serverConsoleClient.systemFeatures.get(undefined, {
        context: await getServerConsoleClientContext(),
        signal: AbortSignal.any([signal, AbortSignal.timeout(SYSTEM_FEATURES_REQUEST_TIMEOUT)]),
      }),
  })
}
