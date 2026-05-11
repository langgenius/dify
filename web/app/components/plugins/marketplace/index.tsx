import type { SearchParams } from 'nuqs'
import { TanstackQueryInitializer } from '@/context/query-client'
import Description from './description'
import { HydrateQueryClient } from './hydration-server'
import ListWrapper from './list/list-wrapper'
import StickySearchAndSwitchWrapper from './sticky-search-and-switch-wrapper'

type MarketplaceProps = {
  showInstallButton?: boolean
  pluginTypeSwitchClassName?: string
  /**
   * Pass the search params from the request to prefetch data on the server.
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
        <Description />
        <StickySearchAndSwitchWrapper
          pluginTypeSwitchClassName={pluginTypeSwitchClassName}
        />
        <ListWrapper
          showInstallButton={showInstallButton}
        />
      </HydrateQueryClient>
    </TanstackQueryInitializer>
  )
}

export default Marketplace
