import type { SearchParams } from 'nuqs'
import type { BannerRecommend } from './home/banners'
import type { Awaitable } from './hydration-server'
import { getLocaleOnServer } from '@/i18n-config/server'
import { cn } from '@/utils/classnames'
import MarketplaceHome from './home'
import { fetchPluginRecommendBanners } from './home/banners'
import { HydrateClient } from './hydration-client'
import { HydrateQueryClient } from './hydration-server'
import MarketplaceContent from './marketplace-content'
import MarketplaceHeader from './marketplace-header'

type MarketplaceVariant = 'default' | 'home'

type MarketplaceProps = {
  showInstallButton?: boolean
  /**
   * Pass the search params & params from the request to prefetch data on the server.
   */
  params?: Awaitable<{ category?: string, creationType?: string, searchTab?: string } | undefined>
  searchParams?: Awaitable<SearchParams>
  /**
   * Whether the marketplace is the platform marketplace.
   */
  isMarketplacePlatform?: boolean
  marketplaceNav?: React.ReactNode
  variant?: MarketplaceVariant
  language?: string
  homeHeaderActions?: React.ReactNode
}

const Marketplace = async ({
  showInstallButton = true,
  params,
  searchParams,
  isMarketplacePlatform = false,
  marketplaceNav,
  variant = 'default',
  language,
  homeHeaderActions,
}: MarketplaceProps) => {
  let trendingBanners: BannerRecommend[] = []

  if (variant === 'home') {
    const locale = language ?? await getLocaleOnServer()

    try {
      trendingBanners = await fetchPluginRecommendBanners(locale)
    }
    catch {
      // Keep the homepage available if Marketplace banner delivery is unavailable.
    }
  }

  return (
    <HydrateQueryClient
      isMarketplacePlatform={isMarketplacePlatform}
      searchParams={searchParams}
      params={params}
    >
      <HydrateClient
        isMarketplacePlatform={isMarketplacePlatform}
      >
        {variant === 'home'
          ? (
              <MarketplaceHome
                actions={homeHeaderActions}
                banners={trendingBanners}
                isMarketplacePlatform={isMarketplacePlatform}
                showInstallButton={showInstallButton}
              />
            )
          : (
              <>
                <MarketplaceHeader descriptionClassName={cn('mx-12 mt-1', isMarketplacePlatform && 'top-0 mx-0 mt-0 rounded-none')} marketplaceNav={marketplaceNav} />
                <MarketplaceContent
                  showInstallButton={showInstallButton}
                />
              </>
            )}
      </HydrateClient>
    </HydrateQueryClient>
  )
}

export default Marketplace
