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
  showInstallButton?: boolean
  shouldExclude?: boolean
  searchParams?: SearchParams
}
const Marketplace = async ({
  locale,
  showInstallButton = true,
  shouldExclude,
  searchParams,
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
      <MarketplaceContextProvider searchParams={searchParams} shouldExclude={shouldExclude}>
        <Description locale={locale} />
        <IntersectionLine />
        <SearchBoxWrapper locale={locale} />
        <PluginTypeSwitch locale={locale} />
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
