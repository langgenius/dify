import type { SearchParams } from 'nuqs'
import Marketplace from '@/app/components/plugins/marketplace'
import MarketplaceInstallPermissionProvider from '@/app/components/plugins/marketplace/marketplace-install-permission-provider'

type MarketplacePageProps = {
  searchParams?: Promise<SearchParams>
}

const MarketplacePage = ({ searchParams }: MarketplacePageProps) => {
  return (
    <div
      id="marketplace-container"
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-background-default-subtle pr-1"
    >
      <MarketplaceInstallPermissionProvider>
        <Marketplace searchParams={searchParams} isMarketplacePlatform showInstallButton />
      </MarketplaceInstallPermissionProvider>
    </div>
  )
}

export default MarketplacePage
