import type { SystemFeatures } from '@/types/feature'
import { queryOptions } from '@tanstack/react-query'
import { defaultSystemFeatures } from '@/types/feature'
import { consoleClient, consoleQuery } from './client'

/**
 * Soft-fallback to defaults so the dashboard stays usable when /system-features fails.
 *
 * No `retry`: the queryFn never throws (errors are caught and turned into the
 * default payload), so react-query's retry would never fire under this model.
 * This trades main's transient-blip resilience for guaranteed dashboard
 * availability via defaults; the trade-off is acceptable because /system-features
 * is a small, dependency-free endpoint in the community edition.
 *
 * No `staleTime` override either: inherit the 5-minute default from
 * query-client-server.ts. Combined with `refetchOnWindowFocus`, this lets us
 * recover from a transient startup failure (which got cached as "successful
 * defaults") within ~5 minutes or on tab focus. `staleTime: Infinity` would
 * pin the whole tab to defaults until reload — strictly worse than main.
 */
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
  })
