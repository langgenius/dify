import type { SystemFeatures } from './config'
import { queryOptions } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/client'
import { defaultSystemFeatures } from './config'

/**
 * Soft-fallback to defaults so the dashboard stays usable when /system-features fails.
 *
 * No `retry`: the queryFn never throws (errors are caught and turned into the
 * default payload), so react-query's retry would never fire under this model.
 * This trades main's transient-blip resilience for guaranteed dashboard
 * availability via defaults; the trade-off is acceptable because /system-features
 * is a small, dependency-free endpoint.
 *
 * All deployments use the same backend-owned payload and inherit the shared
 * five-minute stale time from the query client.
 */
export const systemFeaturesQueryOptions = () => {
  const queryKey = consoleQuery.systemFeatures.get.queryKey()

  return queryOptions<SystemFeatures>({
    queryKey,
    queryFn: async () => {
      try {
        return await consoleClient.systemFeatures.get()
      } catch (err) {
        console.error('[systemFeatures] fetch failed, using defaults', err)
        return defaultSystemFeatures
      }
    },
  })
}
