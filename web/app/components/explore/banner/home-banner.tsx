import { getQueryClientServer } from '@/context/query-client-server'
import { serverConsoleQuery } from '@/service/server'
import { Banner } from './banner'
import { getHomeBanners } from './data'

export async function HomeBanner() {
  // RootLayout prefetches this exact query, so this normally reads the request-scoped cache.
  const systemFeatures = await getQueryClientServer()
    .ensureQueryData(serverConsoleQuery.systemFeatures.get.queryOptions())
    .catch(() => null)

  if (!systemFeatures?.enable_explore_banner) return <Banner banners={[]} />

  const banners = await getHomeBanners().catch(() => {
    // Banner data is optional; retain the greeting shell when its request fails.
    return []
  })

  return <Banner banners={banners} />
}
