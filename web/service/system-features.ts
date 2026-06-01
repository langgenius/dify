import type { SystemFeatures } from '@/types/feature'
import { queryOptions } from '@tanstack/react-query'
import { IS_CLOUD_EDITION } from '@/config'
import { cloudSystemFeatures } from '@/config/cloud-system-features'
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
 * For Cloud, this query is intentionally local-only and uses `staleTime:
 * Infinity`: the payload comes from frontend config/defaults, so refetching
 * would only re-run the same local merge. For non-Cloud, do not override
 * `staleTime`: inherit the 5-minute default from query-client-server.ts.
 */
export const systemFeaturesQueryOptions = () => {
  const queryKey = consoleQuery.systemFeatures.queryKey()

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
        return await consoleClient.systemFeatures()
      }
      catch (err) {
        console.error('[systemFeatures] fetch failed, using defaults', err)
        return defaultSystemFeatures
      }
    },
  })
}
