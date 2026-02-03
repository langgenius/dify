import type { SearchParams } from 'nuqs'
import { TanstackQueryInitializer } from '@/context/query-client'
import { HydrateQueryClient } from './hydration-server'
import ListWrapper from './list/list-wrapper'
import MarketplaceHeader from './marketplace-header'

type MarketplaceProps = {
  showInstallButton?: boolean
  /**
   * Pass the search params from the request to prefetch data on the server.
   */
  searchParams?: Promise<SearchParams>
}

const Marketplace = async ({
  showInstallButton = true,
  searchParams,
}: MarketplaceProps) => {
  return (
    <TanstackQueryInitializer>
      <HydrateQueryClient searchParams={searchParams}>
        <MarketplaceHeader descriptionClassName="mx-12 mt-1" />
        <ListWrapper
          showInstallButton={showInstallButton}
        />
      </HydrateQueryClient>
    </TanstackQueryInitializer>
  )
}

export default Marketplace
