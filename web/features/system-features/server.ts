import type { SystemFeatures } from './types'
import { queryOptions } from '@tanstack/react-query'
import { IS_CLOUD_EDITION } from '@/config'
import {
  getServerConsoleClientContext,
  serverConsoleClient,
  serverConsoleQuery,
} from '@/service/server'
import { cloudSystemFeatures } from './config'
import { defaultSystemFeatures } from './types'

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
