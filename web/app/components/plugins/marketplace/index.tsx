import type { SearchParams } from 'nuqs'
import type { BannerRecommend } from './home/banners'
import { PluginInstallPermissionProviderGuard } from '@/app/components/plugins/install-plugin/components/plugin-install-permission-provider'
import { TanstackQueryInitializer } from '@/context/query-client'
import { getLocaleOnServer } from '@/i18n-config/server'
import Description from './description'
import MarketplaceHome from './home'
import { fetchPluginRecommendBanners } from './home/banners'
import { HydrateQueryClient } from './hydration-server'
import ListWrapper from './list/list-wrapper'
import StickySearchAndSwitchWrapper from './sticky-search-and-switch-wrapper'

type MarketplaceVariant = 'default' | 'home'

type MarketplaceProps = {
  showInstallButton?: boolean
  linkToMarketplaceDetail?: boolean
  pluginTypeSwitchClassName?: string
  isMarketplacePlatform?: boolean
  marketplaceNav?: React.ReactNode
  variant?: MarketplaceVariant
  language?: string
  homeHeaderActions?: React.ReactNode
  /**
   * Pass the search params from the request to prefetch data on the server.
   */
  searchParams?: Promise<SearchParams>
}

const Marketplace = async ({
  showInstallButton = false,
  linkToMarketplaceDetail = false,
  pluginTypeSwitchClassName,
  isMarketplacePlatform = false,
  marketplaceNav,
  variant = 'default',
  language,
  homeHeaderActions,
  searchParams,
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
    <TanstackQueryInitializer>
      <HydrateQueryClient searchParams={searchParams}>
        <PluginInstallPermissionProviderGuard canInstallPlugin={showInstallButton}>
          {variant === 'home'
            ? (
                <MarketplaceHome
                  actions={homeHeaderActions}
                  banners={trendingBanners}
                  isMarketplacePlatform={isMarketplacePlatform}
                  linkToMarketplaceDetail={linkToMarketplaceDetail}
                  showInstallButton={showInstallButton}
                />
              )
            : (
                <>
                  <Description
                    isMarketplacePlatform={isMarketplacePlatform}
                    marketplaceNav={marketplaceNav}
                  />
                  {!isMarketplacePlatform && (
                    <StickySearchAndSwitchWrapper pluginTypeSwitchClassName={pluginTypeSwitchClassName} />
                  )}
                  <ListWrapper
                    showInstallButton={showInstallButton}
                    linkToMarketplaceDetail={linkToMarketplaceDetail}
                  />
                </>
              )}
        </PluginInstallPermissionProviderGuard>
      </HydrateQueryClient>
    </TanstackQueryInitializer>
  )
}

export default Marketplace
