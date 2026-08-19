import AccountSection from '@/app/components/main-nav/components/account-section'
import { MARKETPLACE_CONTAINER_ID } from '@/app/components/plugins/marketplace/constants'
import { EmbeddedMarketplace } from '@/app/components/plugins/marketplace/embedded'
import MarketplaceInstallPermissionProvider from '@/app/components/plugins/marketplace/marketplace-install-permission-provider'

// This route must not render async Server Components. Under the client console
// shell, Flight double-resolves streamed children and throws
// `reason.enqueueModel` on cloud.dify.dev. Data fetching stays on the client.
const MarketplacePage = () => {
  return (
    <div
      id={MARKETPLACE_CONTAINER_ID}
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-background-default"
    >
      <MarketplaceInstallPermissionProvider>
        <EmbeddedMarketplace
          showInstallButton
          variant="home"
          homeHeaderActions={
            <div className="p-0.5">
              <AccountSection compact />
            </div>
          }
        />
      </MarketplaceInstallPermissionProvider>
    </div>
  )
}

export default MarketplacePage
