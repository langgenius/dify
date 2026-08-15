import type { SearchParams } from 'nuqs'
import AccountSection from '@/app/components/main-nav/components/account-section'
import { EmbeddedMarketplace } from '@/app/components/plugins/marketplace/embedded'
import { fetchPluginBanners } from '@/app/components/plugins/marketplace/home/banners'
import { HydrateQueryClient } from '@/app/components/plugins/marketplace/hydration-server'
import MarketplaceInstallPermissionProvider from '@/app/components/plugins/marketplace/marketplace-install-permission-provider'
import { getLocaleOnServer } from '@/i18n-config/server'

type MarketplacePageProps = {
  searchParams?: Promise<SearchParams>
}

const MarketplacePage = async ({ searchParams }: MarketplacePageProps) => {
  const initialLocale = await getLocaleOnServer()
  const initialBanners = await fetchPluginBanners(initialLocale).catch(() => undefined)

  return (
    <div
      id="marketplace-container"
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-background-default"
    >
      <MarketplaceInstallPermissionProvider>
        <HydrateQueryClient searchParams={searchParams}>
          <EmbeddedMarketplace
            initialBanners={initialBanners}
            initialLocale={initialLocale}
            showInstallButton
            variant="home"
            homeHeaderActions={
              <div className="p-0.5">
                <AccountSection compact />
              </div>
            }
          />
        </HydrateQueryClient>
      </MarketplaceInstallPermissionProvider>
    </div>
  )
}

export default MarketplacePage
