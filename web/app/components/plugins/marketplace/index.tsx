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
  searchParams?: SearchParams
}
const Marketplace = async ({
  locale,
  showInstallButton = true,
  searchParams,
}: MarketplaceProps) => {
  const { marketplaceCollections, marketplaceCollectionPluginsMap } = await getMarketplaceCollectionsAndPlugins()

  return (
    <TanstackQueryIniter>
      <MarketplaceContextProvider searchParams={searchParams}>
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
