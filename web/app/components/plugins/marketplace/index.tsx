import type { PluginBanner } from '@dify/contracts/marketplace'
import type { SearchParams } from 'nuqs'
import type { MarketplaceViewProps } from './view'
import { getLocaleOnServer } from '@/i18n-config/server'
import { fetchPluginBanners } from './home/banners'
import { HydrateQueryClient } from './hydration-server'
import { MarketplaceView } from './view'

type MarketplaceProps = Omit<MarketplaceViewProps, 'banners'> & {
  language?: string
  /**
   * Pass the search params from the request to prefetch data on the server.
   */
  searchParams?: Promise<SearchParams>
}

const Marketplace = async ({
  language,
  searchParams,
  variant = 'default',
  ...viewProps
}: MarketplaceProps) => {
  let trendingBanners: PluginBanner[] = []

  if (variant === 'home') {
    const locale = language ?? (await getLocaleOnServer())

    try {
      trendingBanners = await fetchPluginBanners(locale)
    } catch {
      // Keep the homepage available if Marketplace banner delivery is unavailable.
    }
  }

  return (
    <HydrateQueryClient searchParams={searchParams}>
      <MarketplaceView
        {...viewProps}
        banners={trendingBanners}
        language={language}
        variant={variant}
      />
    </HydrateQueryClient>
  )
}

export default Marketplace
