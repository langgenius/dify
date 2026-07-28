import AccountDropdown from '@/app/components/header/account-dropdown'
import { EmbeddedMarketplace } from '@/app/components/plugins/marketplace/embedded'
import { fetchPluginBanners } from '@/app/components/plugins/marketplace/home/banners'
import MarketplaceInstallPermissionProvider from '@/app/components/plugins/marketplace/marketplace-install-permission-provider'
import { getLocaleOnServer } from '@/i18n-config/server'

const MarketplacePage = async () => {
  const initialBanners = await getLocaleOnServer()
    .then(fetchPluginBanners)
    .catch(() => undefined)

  return (
    <div
      id="marketplace-container"
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-background-default"
    >
      <MarketplaceInstallPermissionProvider>
        <EmbeddedMarketplace
          initialBanners={initialBanners}
          showInstallButton
          variant="home"
          homeHeaderActions={
            <div className="p-0.5">
              <AccountDropdown />
            </div>
          }
        />
      </MarketplaceInstallPermissionProvider>
    </div>
  )
}

export default MarketplacePage
