import type { SystemFeatures } from '@/types/feature'
import { queryOptions } from '@tanstack/react-query'
import { IS_CLOUD_EDITION } from '@/config'
import { cloudSystemFeatures } from '@/config/cloud-system-features'
import { defaultSystemFeatures } from '@/types/feature'
import {
  getServerConsoleClientContext,
  serverConsoleClient,
  serverConsoleQuery,
} from './server'

export const serverSystemFeaturesQueryOptions = () => {
  const queryKey = serverConsoleQuery.systemFeatures.queryKey()

  if (IS_CLOUD_EDITION) {
    return queryOptions<SystemFeatures>({
      queryKey,
      queryFn: async () => cloudSystemFeatures,
      staleTime: Infinity,
    })
  }

  return queryOptions<SystemFeatures>({
    queryKey,
    queryFn: async () => {
      try {
        return await serverConsoleClient.systemFeatures(undefined, {
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
