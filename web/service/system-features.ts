import type { SystemFeatures } from '@/types/feature'
import { queryOptions } from '@tanstack/react-query'
import { defaultSystemFeatures } from '@/types/feature'
import { consoleClient, consoleQuery } from './client'

/** Soft-fallback to defaults so the dashboard stays usable when /system-features fails. */
export const systemFeaturesQueryOptions = () =>
  queryOptions<SystemFeatures>({
    queryKey: consoleQuery.systemFeatures.queryKey(),
    queryFn: async () => {
      try {
        return await consoleClient.systemFeatures()
      }
      catch (err) {
        console.error('[systemFeatures] fetch failed, using defaults', err)
        return defaultSystemFeatures
      }
    },
    staleTime: Infinity,
    retry: 2,
    retryDelay: attempt => Math.min(500 * 2 ** attempt, 4000),
  })
