import type { SystemFeatures } from '@/types/feature'
import { queryOptions } from '@tanstack/react-query'
import { defaultSystemFeatures } from '@/types/feature'
import {
  getServerConsoleClientContext,
  serverConsoleClient,
  serverConsoleQuery,
} from './server'

export const serverSystemFeaturesQueryOptions = () =>
  queryOptions<SystemFeatures>({
    queryKey: serverConsoleQuery.systemFeatures.queryKey(),
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
