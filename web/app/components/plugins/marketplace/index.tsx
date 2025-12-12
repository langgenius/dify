import { MarketplaceContextProvider } from './context'
import Description from './description'
import StickySearchAndSwitchWrapper from './sticky-search-and-switch-wrapper'
import ListWrapper from './list/list-wrapper'
import type { MarketplaceCollection, SearchParams } from './types'
import type { Plugin } from '@/app/components/plugins/types'
import { getMarketplaceCollectionsAndPlugins } from './utils'
import { TanstackQueryInitializer } from '@/context/query-client'

type MarketplaceProps = {
  locale: string
  showInstallButton?: boolean
  shouldExclude?: boolean
  searchParams?: SearchParams
  pluginTypeSwitchClassName?: string
  scrollContainerId?: string
  showSearchParams?: boolean
}
const Marketplace = async ({
  locale,
  showInstallButton = true,
  shouldExclude,
  searchParams,
  pluginTypeSwitchClassName,
  scrollContainerId,
  showSearchParams = true,
}: MarketplaceProps) => {
  let marketplaceCollections: MarketplaceCollection[] = []
  let marketplaceCollectionPluginsMap: Record<string, Plugin[]> = {}
  if (!shouldExclude) {
    const marketplaceCollectionsAndPluginsData = await getMarketplaceCollectionsAndPlugins()
    marketplaceCollections = marketplaceCollectionsAndPluginsData.marketplaceCollections
    marketplaceCollectionPluginsMap = marketplaceCollectionsAndPluginsData.marketplaceCollectionPluginsMap
  }

  return (
    <TanstackQueryInitializer>
      <MarketplaceContextProvider
        searchParams={searchParams}
        shouldExclude={shouldExclude}
        scrollContainerId={scrollContainerId}
        showSearchParams={showSearchParams}
      >
        <Description locale={locale} />
        <StickySearchAndSwitchWrapper
          locale={locale}
          pluginTypeSwitchClassName={pluginTypeSwitchClassName}
          showSearchParams={showSearchParams}
        />
        <ListWrapper
          locale={locale}
          marketplaceCollections={marketplaceCollections}
          marketplaceCollectionPluginsMap={marketplaceCollectionPluginsMap}
          showInstallButton={showInstallButton}
        />
      </MarketplaceContextProvider>
    </TanstackQueryInitializer>
  )
}

export default Marketplace
