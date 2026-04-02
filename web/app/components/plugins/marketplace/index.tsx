import type { SearchParams } from 'nuqs'
import type { Awaitable } from './hydration-server'
import { TanstackQueryInitializer } from '@/context/query-client'
import { cn } from '@/utils/classnames'
import { HydrateClient } from './hydration-client'
import { HydrateQueryClient } from './hydration-server'
import MarketplaceContent from './marketplace-content'
import MarketplaceHeader from './marketplace-header'

type MarketplaceProps = {
  showInstallButton?: boolean
  /**
   * Pass the search params & params from the request to prefetch data on the server.
   */
  params?: Awaitable<{ category?: string, creationType?: string, searchTab?: string } | undefined>
  searchParams?: Awaitable<SearchParams>
  /**
   * Whether the marketplace is the platform marketplace.
   */
  isMarketplacePlatform?: boolean
  marketplaceNav?: React.ReactNode
}

const Marketplace = ({
  showInstallButton = true,
  params,
  searchParams,
  isMarketplacePlatform = false,
  marketplaceNav,
}: MarketplaceProps) => {
  return (
    <TanstackQueryInitializer>
      <HydrateQueryClient
        isMarketplacePlatform={isMarketplacePlatform}
        searchParams={searchParams}
        params={params}
      >
        <HydrateClient
          isMarketplacePlatform={isMarketplacePlatform}
        >
          <MarketplaceHeader descriptionClassName={cn('mx-12 mt-1', isMarketplacePlatform && 'top-0 mx-0 mt-0 rounded-none')} marketplaceNav={marketplaceNav} />
          <MarketplaceContent
            showInstallButton={showInstallButton}
          />
        </HydrateClient>
      </HydrateQueryClient>
    </TanstackQueryInitializer>
  )
}

export default Marketplace
