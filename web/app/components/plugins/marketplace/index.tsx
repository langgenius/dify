import { MarketplaceContextProvider } from './context'
import Description from './description'
import IntersectionLine from './intersection-line'
import SearchBoxWrapper from './search-box/search-box-wrapper'
import PluginTypeSwitch from './plugin-type-switch'
import ListWrapper from './list/list-wrapper'
import type { SearchParams } from './types'
import { getMarketplaceCollectionsAndPlugins } from './utils'
import { TanstackQueryIniter } from '@/context/query-client'

type MarketplaceProps = {
  locale: string
  searchBoxAutoAnimate?: boolean
  showInstallButton?: boolean
  shouldExclude?: boolean
  searchParams?: SearchParams
  pluginTypeSwitchClassName?: string
  intersectionContainerId?: string
  scrollContainerId?: string
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
}: MarketplaceProps) => {
  let marketplaceCollections: any = []
  let marketplaceCollectionPluginsMap = {}
  if (!shouldExclude) {
    const marketplaceCollectionsAndPluginsData = await getMarketplaceCollectionsAndPlugins()
    marketplaceCollections = marketplaceCollectionsAndPluginsData.marketplaceCollections
    marketplaceCollectionPluginsMap = marketplaceCollectionsAndPluginsData.marketplaceCollectionPluginsMap
  }

  return (
    <TanstackQueryIniter>
      <MarketplaceContextProvider
        searchParams={searchParams}
        shouldExclude={shouldExclude}
        scrollContainerId={scrollContainerId}
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
        />
        <ListWrapper
          locale={locale}
          marketplaceCollections={marketplaceCollections}
          marketplaceCollectionPluginsMap={marketplaceCollectionPluginsMap}
          showInstallButton={showInstallButton}
        />
      </MarketplaceContextProvider>
    </TanstackQueryIniter>
  )
}

export default Marketplace
