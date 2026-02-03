import type { SearchParams } from 'nuqs'
import { TanstackQueryInitializer } from '@/context/query-client'
import { Description } from './description'
import { HydrateQueryClient } from './hydration-server'
import ListWrapper from './list/list-wrapper'

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
        <Description className="mx-12 mt-1" />
        <ListWrapper
          showInstallButton={showInstallButton}
        />
      </HydrateQueryClient>
    </TanstackQueryInitializer>
  )
}

export default Marketplace
