import type { SearchParams } from 'nuqs'
import { TanstackQueryInitializer } from '@/context/query-client'
import Description from './description'
import { HydrateMarketplaceAtoms } from './hydration-client'
import { HydrateQueryClient } from './hydration-server'
import ListWrapper from './list/list-wrapper'
import StickySearchAndSwitchWrapper from './sticky-search-and-switch-wrapper'

type MarketplaceProps = {
  showInstallButton?: boolean
  pluginTypeSwitchClassName?: string
  /**
   * Pass the search params from the request to prefetch data on the server
   * and preserve the search params in the URL.
   */
  searchParams?: Promise<SearchParams>
}

const Marketplace = async ({
  showInstallButton = true,
  pluginTypeSwitchClassName,
  searchParams,
}: MarketplaceProps) => {
  return (
    <TanstackQueryInitializer>
      <HydrateQueryClient searchParams={searchParams}>
        <HydrateMarketplaceAtoms preserveSearchStateInQuery={!!searchParams}>
          <Description />
          <StickySearchAndSwitchWrapper
            pluginTypeSwitchClassName={pluginTypeSwitchClassName}
          />
          <ListWrapper
            showInstallButton={showInstallButton}
          />
        </HydrateMarketplaceAtoms>
      </HydrateQueryClient>
    </TanstackQueryInitializer>
  )
}

export default Marketplace
