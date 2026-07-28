import AccountDropdown from '@/app/components/header/account-dropdown'
import { EmbeddedMarketplace } from '@/app/components/plugins/marketplace/embedded'
import MarketplaceInstallPermissionProvider from '@/app/components/plugins/marketplace/marketplace-install-permission-provider'

const MarketplacePage = () => {
  return (
    <div
      id="marketplace-container"
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-background-default"
    >
      <MarketplaceInstallPermissionProvider>
        <EmbeddedMarketplace
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
