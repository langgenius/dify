import type { SearchParams } from 'nuqs'
import { TanstackQueryInitializer } from '@/context/query-client'
import { cn } from '@/utils/classnames'
import { HydrateQueryClient } from './hydration-server'
import MarketplaceContent from './marketplace-content'
import MarketplaceHeader from './marketplace-header'

type MarketplaceProps = {
  showInstallButton?: boolean
  /**
   * Pass the search params from the request to prefetch data on the server.
   */
  searchParams?: Promise<SearchParams>
  /**
   * Whether the marketplace is the platform marketplace.
   */
  isMarketplacePlatform?: boolean
  marketplaceNav?: React.ReactNode
}

const Marketplace = async ({
  showInstallButton = true,
  searchParams,
  isMarketplacePlatform = false,
  marketplaceNav,
}: MarketplaceProps) => {
  return (
    <TanstackQueryInitializer>
      <HydrateQueryClient searchParams={searchParams}>
        <MarketplaceHeader descriptionClassName={cn('mx-12 mt-1', isMarketplacePlatform && 'top-0 mx-0 mt-0 rounded-none')} marketplaceNav={marketplaceNav} />
        <MarketplaceContent
          showInstallButton={showInstallButton}
        />
      </HydrateQueryClient>
    </TanstackQueryInitializer>
  )
}

export default Marketplace
