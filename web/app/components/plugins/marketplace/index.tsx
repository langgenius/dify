import type { PluginBanner } from '@dify/contracts/marketplace'
import type { SearchParams } from 'nuqs'
import type { MarketplaceViewProps } from './view'
import { getLocaleOnServer } from '@/i18n-config/server'
import { fetchPluginBanners } from './home/banners'
import { HydrateQueryClient } from './hydration-server'
import { prefetchMarketplaceDehydratedState } from './prefetch-marketplace-dehydrated-state'
import { withinServerBudget } from './server-budget'
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
    const prefetch = prefetchMarketplaceDehydratedState(searchParams)

    // Banners are decoration on a page whose point is the catalog. Overlap
    // them with the catalog prefetch so the document waits at most one budget.
    // A late banner resolution just misses this render; nothing waits on it.
    await withinServerBudget(
      Promise.all([
        fetchPluginBanners(locale)
          .then((banners) => {
            trendingBanners = banners
          })
          .catch(() => {
            // Keep the homepage available if Marketplace banner delivery is down.
          }),
        prefetch,
      ]),
    )

    return (
      <HydrateQueryClient searchParams={undefined} prefetchedState={await prefetch}>
        <MarketplaceView
          {...viewProps}
          banners={trendingBanners}
          language={language}
          variant={variant}
        />
      </HydrateQueryClient>
    )
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
