import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import { queryOptions } from '@tanstack/react-query'
import { IS_CLOUD_EDITION } from '@/config'
// eslint-disable-next-line no-restricted-imports
import { getPublic } from '@/service/base'
import { consoleClient, consoleQuery } from '@/service/client'
import { cloudSystemFeatures, defaultSystemFeatures } from './config'

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
 * 'static'`: the payload comes from frontend config/defaults, so invalidation
 * should not re-run the same local merge. For non-Cloud, do not override
 * `staleTime`: inherit the 5-minute default from query-client-server.ts.
 */
const WEB_APP_SYSTEM_FEATURES_QUERY_KEY = ['webapp', 'system-features'] as const

/**
 * System features for published web apps. Uses the unauthenticated web API so
 * anonymous visitors are not sent through console auth recovery.
 */
export const webAppSystemFeaturesQueryOptions = () => {
  if (IS_CLOUD_EDITION) {
    return queryOptions<GetSystemFeaturesResponse>({
      queryKey: WEB_APP_SYSTEM_FEATURES_QUERY_KEY,
      queryFn: async () => cloudSystemFeatures,
      staleTime: 'static',
    })
  }

  return queryOptions<GetSystemFeaturesResponse>({
    queryKey: WEB_APP_SYSTEM_FEATURES_QUERY_KEY,
    queryFn: async () => {
      try {
        return await getPublic<GetSystemFeaturesResponse>('/system-features', {}, { silent: true })
      }
      catch (err) {
        console.error('[webAppSystemFeatures] fetch failed, using defaults', err)
        return defaultSystemFeatures
      }
    },
  })
}

export const systemFeaturesQueryOptions = () => {
  const queryKey = consoleQuery.systemFeatures.get.queryKey()

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
        return await consoleClient.systemFeatures.get()
      }
      catch (err) {
        console.error('[systemFeatures] fetch failed, using defaults', err)
        return defaultSystemFeatures
      }
    },
  })
}
