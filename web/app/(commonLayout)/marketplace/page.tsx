import type { SearchParams } from 'nuqs'
import AccountDropdown from '@/app/components/header/account-dropdown'
import Marketplace from '@/app/components/plugins/marketplace'
import MarketplaceInstallPermissionProvider from '@/app/components/plugins/marketplace/marketplace-install-permission-provider'

type MarketplacePageProps = {
  searchParams?: Promise<SearchParams>
}

const MarketplacePage = ({ searchParams }: MarketplacePageProps) => {
  return (
    <div
      id="marketplace-container"
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-background-default"
    >
      <MarketplaceInstallPermissionProvider>
        <Marketplace
          searchParams={searchParams}
          showInstallButton
          variant="home"
          homeHeaderActions={(
            <div className="p-0.5">
              <AccountDropdown />
            </div>
          )}
        />
      </MarketplaceInstallPermissionProvider>
    </div>
  )
}

export default MarketplacePage
