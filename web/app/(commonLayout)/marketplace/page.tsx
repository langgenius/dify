import type { SearchParams } from 'nuqs'
import AccountSection from '@/app/components/main-nav/components/account-section'
import { MARKETPLACE_CONTAINER_ID } from '@/app/components/plugins/marketplace/constants'
import { EmbeddedMarketplace } from '@/app/components/plugins/marketplace/embedded'
import { HydrateQueryClient } from '@/app/components/plugins/marketplace/hydration-server'
import MarketplaceInstallPermissionProvider from '@/app/components/plugins/marketplace/marketplace-install-permission-provider'

type MarketplacePageProps = {
  searchParams?: Promise<SearchParams>
}

// This route module must stay synchronous. An async page under the client
// console shell (MainNavLayout / context providers) makes Flight double-resolve
// the marketplace segment (`reason.enqueueModel`) on cloud.dify.dev.
const MarketplacePage = ({ searchParams }: MarketplacePageProps) => {
  return (
    <div
      id={MARKETPLACE_CONTAINER_ID}
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-background-default"
    >
      <HydrateQueryClient searchParams={searchParams}>
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
      </HydrateQueryClient>
    </div>
  )
}

export default MarketplacePage
