import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import { queryOptions } from '@tanstack/react-query'
import { IS_CLOUD_EDITION } from '@/config'
import {
  getServerConsoleClientContext,
  serverConsoleClient,
  serverConsoleQuery,
} from '@/service/server'
import { cloudSystemFeatures, defaultSystemFeatures } from './config'

export const serverSystemFeaturesQueryOptions = () => {
  const queryKey = serverConsoleQuery.systemFeatures.get.queryKey()

  if (IS_CLOUD_EDITION) {
    return queryOptions<GetSystemFeaturesResponse>({
      queryKey,
      queryFn: async () => cloudSystemFeatures,
      staleTime: 'static',
    })
  }

  return queryOptions<GetSystemFeaturesResponse>({
    queryKey,
    queryFn: async () => {
      try {
        return await serverConsoleClient.systemFeatures.get(undefined, {
          context: await getServerConsoleClientContext(),
        })
      }
      catch (err) {
        console.error('[systemFeatures] server fetch failed', err)
        return defaultSystemFeatures
      }
    },
  })
}
