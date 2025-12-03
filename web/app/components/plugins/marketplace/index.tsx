import { MarketplaceContextProvider } from './context'
import Description from './description'
import IntersectionLine from './intersection-line'
import SearchBoxWrapper from './search-box/search-box-wrapper'
import PluginTypeSwitch from './plugin-type-switch'
import ListWrapper from './list/list-wrapper'
import type { MarketplaceCollection, SearchParams } from './types'
import type { Plugin } from '@/app/components/plugins/types'
import { getMarketplaceCollectionsAndPlugins } from './utils'
import { TanstackQueryInitializer } from '@/context/query-client'

type MarketplaceProps = {
  locale: string
  searchBoxAutoAnimate?: boolean
  showInstallButton?: boolean
  shouldExclude?: boolean
  searchParams?: SearchParams
  pluginTypeSwitchClassName?: string
  intersectionContainerId?: string
  scrollContainerId?: string
  showSearchParams?: boolean
}
const Marketplace = async ({
  locale,
  searchBoxAutoAnimate = true,
  showInstallButton = true,
  shouldExclude,
  searchParams,
  pluginTypeSwitchClassName,
  intersectionContainerId,
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
        <IntersectionLine intersectionContainerId={intersectionContainerId} />
        <SearchBoxWrapper
          locale={locale}
          searchBoxAutoAnimate={searchBoxAutoAnimate}
        />
        <PluginTypeSwitch
          locale={locale}
          className={pluginTypeSwitchClassName}
          searchBoxAutoAnimate={searchBoxAutoAnimate}
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
